"""
Target segment estimation — deciding *which part of the recording* to measure.

This is the hardest step in the stage and the one most worth being explicit
about. A forced aligner (wav2vec2 CTC + `torchaudio.forced_align`) would do
this properly by aligning the expected phoneme sequence to the audio, and
ARCHITECTURE.md §3 still describes that as the upgrade path. What is
implemented here is a signal-processing landmark detector: it looks for the
acoustic event a given target *is*, rather than reading it off an alignment.

Two detectors, one per feature family:

  Fricative targets (/s/, /th/)
      A fricative is a stretch of aperiodic energy with a high-frequency
      bias. Frames are scored on exactly those three properties — unvoiced,
      high-frequency, above the noise floor — and the best contiguous run
      wins. Nothing about the score is target-specific, so the same run is
      found whether the learner produced /s/, /θ/, /ʃ/ or /t/; only the
      subsequent measurement tells them apart. That independence is the point:
      a detector tuned to find /s/ would find /s/-ish things and bias the
      verdict toward the target.

  Approximant targets (/r/, /l/)
      An approximant next to a vowel has no energy boundary to find — it *is*
      voiced, and it flows into the vowel. So instead of detecting the phone,
      we locate the voiced stretch and take the span at the expected edge of
      it, then measure at the point where the formants are most stable. Again
      target-independent: "most stable formants near the word edge" says
      nothing about whether F3 will turn out to be low.

The estimate carries a `salience` in [0, 1] saying how clearly the landmark
stood out. That number is multiplied into the final confidence, so a segment
we are unsure about cannot produce a result we are sure about.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import (
    FRAME_S,
    MAX_SEGMENT_S,
    MIN_SEGMENT_S,
    SIBILANT_SPLIT_HZ,
)
from .formants import FormantTrack
from .frames import FrameSet
from .phonemes import APPROXIMANT, FRICATIVE, family_of
from .preprocess import Signal

#: Where in the word the target sits. Comes from the prompt bank, which knows
#: its own words; it is never inferred from the recording.
ONSET = "onset"
CODA = "coda"
MEDIAL = "medial"

#: How much of the speech region an onset/coda target may occupy. Generous —
#: the hint narrows the search, it does not pin the answer.
EDGE_WINDOW = 0.60

#: A frication run must clear this share of the clip's own peak salience.
#: Relative rather than absolute because /θ/ is roughly 15 dB quieter than
#: /s/; an absolute floor tuned for one would erase the other.
RUN_THRESHOLD_RATIO = 0.40

#: ...but there does have to be *some* frication. Below this the clip has no
#: aperiodic high-frequency event in it at all, and no amount of relative
#: thresholding should invent one.
MIN_PEAK_SALIENCE = 0.015

#: An approximant before a vowel is short. Cap the span so the following
#: vowel does not get averaged into the measurement.
#:
#: 80 ms, because an English onset approximant holds its constriction for
#: roughly 50-90 ms and the reading has to come from the hold, not from the
#: glide into the vowel.
#:
#: This was 130 ms, which is longer than the sound it is trying to bound. The
#: cost was not subtle: in a word with a long voiced run the window reached
#: past the constriction into the nucleus, and since a vowel is flatter than
#: an approximant, the "most stable frame" rule below then took its reading
#: from the vowel. Measured on "rabbit" - a textbook /r/ with F3 at 1517 Hz -
#: the reading was taken 80 ms later at F3 2131 Hz and the word came back as
#: an /l/ substitution. Telling a learner who said it correctly that they
#: substituted a different sound is the worst answer this stage can give.
#:
#: Swept end to end, rebuilding the reference profiles at each value because
#: reference and learner must be measured the same way:
#:
#:     130 ms  418/504   "rabbit" -> /l/, similarity 0.038   (the bug)
#:     110 ms  418/504   /l/ 0.038
#:      95 ms  420/504   /r/ 0.894
#:      90 ms  418/504   /r/ 0.894
#:      85 ms  422/504   /r/ 0.894
#:      80 ms  426/504   /r/ 0.897                           (chosen)
#:      75 ms  422/504   /r/ 0.886
#:      70 ms  424/504   /r/ 0.907
#:      60 ms  404/504   /r/ 0.912   - now clipping the hold itself
#:
#: 70-95 ms is a plateau rather than a peak, so this is a mid-range choice
#: inside a flat region, not a value tuned to one recording. It improves the
#: corpus and fixes the held-out fixture at the same time.
MAX_APPROXIMANT_S = 0.080
#: ...and never take more than this share of the voiced run, so a very short
#: word does not end up measured as all-approximant.
MAX_APPROXIMANT_RATIO = 0.45

#: Point measurements average over this half-width around the chosen frame.
MEASURE_HALF_S = 0.015


@dataclass(frozen=True)
class SegmentEstimate:
    """Where the target sound appears to be, and how sure we are of that."""

    start_s: float
    end_s: float
    #: The narrower window used for point measurements (formants, spectrum).
    measure_start_s: float
    measure_end_s: float
    #: [0, 1]. How clearly this landmark stood out from the rest of the clip.
    salience: float
    #: Which detector produced it, for the response and for debugging.
    method: str

    @property
    def duration_s(self) -> float:
        return self.end_s - self.start_s


def _search_window(signal: Signal, position: str) -> tuple[float, float]:
    """Narrow the search to the part of the word the target lives in."""
    start = signal.speech_start / signal.sample_rate
    end = signal.speech_end / signal.sample_rate
    span = end - start
    if span <= 0:
        return start, end

    if position == ONSET:
        return start, start + span * EDGE_WINDOW
    if position == CODA:
        return end - span * EDGE_WINDOW, end
    return start, end


def _ramp(value: float, low: float, high: float) -> float:
    if high <= low:
        return 1.0
    return float(np.clip((value - low) / (high - low), 0.0, 1.0))


def frication_salience(frames: FrameSet) -> np.ndarray:
    """
    Per-frame evidence that a frame is frication, in [0, 1].

        salience = unvoiced × high-frequency share × above-the-noise-floor

    A product, not a sum: a vowel is above the floor but voiced and
    low-frequency, and any one of those disqualifies it. A sum would let a
    loud vowel accumulate a competitive score from its loudness alone.
    """
    if frames.n == 0:
        return np.zeros(0, dtype=np.float32)

    unvoiced = np.clip(1.0 - frames.voicing, 0.0, 1.0)

    power = frames.magnitude**2
    total = power.sum(axis=0) + 1e-12
    high = power[frames.freqs >= SIBILANT_SPLIT_HZ].sum(axis=0)
    hf_share = high / total

    floor = float(np.percentile(frames.db, 10))
    # +2 to +10 dB over the floor. Low bounds on purpose: /θ/ frication sits
    # only a few dB above room noise in a normal recording.
    audible = np.clip((frames.db - (floor + 2.0)) / 8.0, 0.0, 1.0)

    return (unvoiced * hf_share * audible).astype(np.float32)


def _best_run(
    salience: np.ndarray, window: slice, threshold: float
) -> tuple[int, int] | None:
    """Highest-integral contiguous run above `threshold` inside `window`."""
    mask = np.zeros(salience.shape, dtype=bool)
    mask[window] = salience[window] > threshold
    if not mask.any():
        return None

    best: tuple[float, int, int] | None = None
    index = 0
    n = len(mask)
    while index < n:
        if not mask[index]:
            index += 1
            continue
        start = index
        while index < n and mask[index]:
            index += 1
        total = float(salience[start:index].sum())
        if best is None or total > best[0]:
            best = (total, start, index)

    return (best[1], best[2]) if best else None


def _locate_frication(
    signal: Signal, frames: FrameSet, position: str
) -> SegmentEstimate | None:
    salience = frication_salience(frames)
    if salience.size == 0:
        return None

    window = frames.window(*_search_window(signal, position))
    inside = salience[window]
    if inside.size == 0 or float(inside.max()) <= 0:
        return None

    threshold = float(inside.max()) * RUN_THRESHOLD_RATIO
    run = _best_run(salience, window, threshold)
    if run is None:
        return None

    start, end = run
    peak = start + int(np.argmax(salience[start:end]))

    # Both length corrections work outward from the salience peak, which is
    # the middle of the frication. Truncating or padding from the left edge
    # instead would drift the measurement onto the transition.
    if (end - start) * FRAME_S > MAX_SEGMENT_S:
        half = int(MAX_SEGMENT_S / FRAME_S / 2)
        start, end = max(start, peak - half), min(end, peak + half)
    elif (end - start) * FRAME_S < MIN_SEGMENT_S:
        # A short run is not a failure to find the sound — /θ/ and /f/ are
        # both quiet and brief, and thresholding at 40% of a low peak clips
        # their run to a couple of frames. The peak is still in the right
        # place (measurably so: it lands within 10 ms of the onset on every
        # reference token), so widen to the minimum measurable window rather
        # than discarding a correct location. The segment's own salience
        # stays low, so the weakness shows up as lower confidence instead of
        # being hidden.
        half = int(MIN_SEGMENT_S / FRAME_S / 2) + 1
        start = max(window.start, peak - half)
        end = min(window.stop, peak + half + 1)

    start_s = float(frames.times[start])
    end_s = float(frames.times[min(end, frames.n - 1)])

    # Salience is reported two ways at once: how strong the run is in
    # absolute terms, and how much it stands out from the rest of the speech.
    # A clip that is frication end to end (noise, a hiss) scores high on the
    # first and low on the second, and should not be trusted.
    mean_inside = float(salience[start:end].mean())
    if mean_inside < MIN_PEAK_SALIENCE:
        return None

    outside = np.concatenate([salience[window][: start - window.start], salience[end:]])
    mean_outside = float(outside.mean()) if outside.size else 0.0
    contrast = mean_inside / (mean_inside + mean_outside + 1e-9)

    # Contrast carries most of the weight, absolute level very little. That
    # ordering is deliberate: the question this number answers is "is the
    # target sound here rather than somewhere else in the clip", and a /θ/
    # that is 20 dB quieter than an /s/ is not 20 dB less well located. The
    # absolute term is only there so a clip that is frication end to end —
    # a hiss, a fan — cannot claim a confident landmark.
    salience_score = _ramp(contrast, 0.45, 0.80) * (
        0.55 + 0.45 * _ramp(mean_inside, 0.015, 0.12)
    )

    return SegmentEstimate(
        start_s=round(start_s, 4),
        end_s=round(end_s, 4),
        measure_start_s=round(start_s, 4),
        measure_end_s=round(end_s, 4),
        salience=round(float(salience_score), 3),
        method="frication-run",
    )


def _longest_voiced_run(frames: FrameSet, window: slice) -> tuple[int, int] | None:
    mask = np.zeros(frames.n, dtype=bool)
    mask[window] = frames.voiced[window]
    if not mask.any():
        return None

    best: tuple[int, int, int] | None = None
    index = 0
    while index < frames.n:
        if not mask[index]:
            index += 1
            continue
        start = index
        while index < frames.n and mask[index]:
            index += 1
        if best is None or (index - start) > best[0]:
            best = (index - start, start, index)

    return (best[1], best[2]) if best else None


def _locate_approximant(
    signal: Signal, frames: FrameSet, formants: FormantTrack, position: str
) -> SegmentEstimate | None:
    window = frames.window(*_search_window(signal, position))
    run = _longest_voiced_run(frames, window)
    if run is None:
        return None

    voiced_start, voiced_end = run
    run_frames = voiced_end - voiced_start
    if run_frames * FRAME_S < MIN_SEGMENT_S:
        return None

    span_frames = int(
        min(MAX_APPROXIMANT_S / FRAME_S, run_frames * MAX_APPROXIMANT_RATIO)
    )
    span_frames = max(span_frames, int(MIN_SEGMENT_S / FRAME_S))

    if position == CODA:
        start, end = max(voiced_start, voiced_end - span_frames), voiced_end
    else:
        start, end = voiced_start, min(voiced_end, voiced_start + span_frames)

    # Measurement point: where the formants move least. An approximant holds
    # its constriction briefly before the transition into the vowel, and that
    # plateau is the standard place to take the reading. Choosing it by
    # stability rather than by "wherever F3 is lowest" keeps the measurement
    # from being biased toward the sound we are hoping to find.
    point = _most_stable_frame(formants, start, end)
    measure_start = max(start, point - int(MEASURE_HALF_S / FRAME_S))
    measure_end = min(end, point + int(MEASURE_HALF_S / FRAME_S) + 1)
    if measure_end <= measure_start:
        measure_start, measure_end = start, end

    # How trustworthy is this landmark? Two things matter: the frames really
    # were voiced, and the formant tracker actually returned values there.
    voicing_strength = float(np.mean(frames.voicing[start:end]))
    tracked = formants.f3[start:end]
    coverage = float(np.mean(np.isfinite(tracked))) if tracked.size else 0.0
    salience = _ramp(voicing_strength, 0.30, 0.70) * _ramp(coverage, 0.3, 0.9)

    return SegmentEstimate(
        start_s=round(float(frames.times[start]), 4),
        end_s=round(float(frames.times[min(end, frames.n - 1)]), 4),
        measure_start_s=round(float(frames.times[measure_start]), 4),
        measure_end_s=round(float(frames.times[min(measure_end, frames.n - 1)]), 4),
        salience=round(float(np.sqrt(salience)), 3),
        method=f"voiced-{'coda' if position == CODA else 'onset'}",
    )


def _most_stable_frame(formants: FormantTrack, start: int, end: int) -> int:
    """Frame in [start, end) where F2 and F3 are changing least."""
    f2 = formants.f2[start:end]
    f3 = formants.f3[start:end]
    if f2.size < 3:
        return start

    velocity = np.abs(np.gradient(np.nan_to_num(f2, nan=0.0))) + np.abs(
        np.gradient(np.nan_to_num(f3, nan=0.0))
    )
    # Frames the tracker could not resolve are not candidates.
    velocity[~(np.isfinite(f2) & np.isfinite(f3))] = np.inf
    if not np.any(np.isfinite(velocity)):
        return start + f2.size // 3

    return start + int(np.argmin(velocity))


def locate(
    target: str,
    signal: Signal,
    frames: FrameSet,
    formants: FormantTrack,
    position: str = ONSET,
) -> SegmentEstimate | None:
    """
    Estimate where the target sound is. Returns None when no plausible
    landmark exists — which is a valid outcome, not an error.
    """
    family = family_of(target)
    if family == FRICATIVE:
        return _locate_frication(signal, frames, position)
    if family == APPROXIMANT:
        return _locate_approximant(signal, frames, formants, position)
    raise ValueError(f"no detector for family {family!r}")  # pragma: no cover
