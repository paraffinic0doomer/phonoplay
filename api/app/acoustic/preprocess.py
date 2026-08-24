"""
Turn uploaded bytes into a signal the rest of the stage can measure.

Three jobs, in order: decode, condition, and locate the speech. Each one is
kept separate because each has a different failure mode, and the analyzer
needs to tell them apart — "that was not audio" and "that was audio with no
speech in it" are different messages to a learner.

Deliberately *not* done here:

  * No pre-emphasis. It is standard before LPC and we apply it inside the
    formant tracker, but applying it globally would shift every spectral
    centroid upward by a target-dependent amount and quietly invalidate the
    reference profiles.
  * No spectral noise reduction. It removes exactly the low-level frication
    that distinguishes /θ/ from silence. A noisy clip should lower our
    confidence, not be cleaned until it looks confident.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import soundfile as sf

from .constants import CLIP_THRESHOLD, HOP_LENGTH, SAMPLE_RATE, WIN_LENGTH


class SignalError(ValueError):
    """The bytes could not be turned into a usable signal."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Signal:
    """Mono float32 audio at a known sample rate, plus where the speech is."""

    samples: np.ndarray
    sample_rate: int
    #: Sample offsets of the speech region inside `samples`. Analysis windows
    #: are constrained to this range; the surrounding silence is kept so the
    #: noise floor can still be measured from it.
    speech_start: int
    speech_end: int
    #: Fraction of samples at full scale within the speech region, measured
    #: on the decoded signal *before* peak normalisation — afterwards the
    #: peak is 0.95 by construction and clipping would be undetectable.
    #: Scoped to the speech because a clip cannot occur in the silent
    #: lead-in, and averaging over it dilutes real clipping toward zero: a
    #: word driven 6x past full scale measures 2.3% across the whole file
    #: and 5.8% across the speech, and only the second number means anything.
    clipped_fraction: float = 0.0

    @property
    def duration_s(self) -> float:
        return len(self.samples) / self.sample_rate

    @property
    def speech_duration_s(self) -> float:
        return (self.speech_end - self.speech_start) / self.sample_rate

    @property
    def speech(self) -> np.ndarray:
        return self.samples[self.speech_start : self.speech_end]

    def slice_s(self, start_s: float, end_s: float) -> np.ndarray:
        a = max(0, int(round(start_s * self.sample_rate)))
        b = min(len(self.samples), int(round(end_s * self.sample_rate)))
        return self.samples[a:b]


def decode(data: bytes, target_sr: int = SAMPLE_RATE) -> tuple[np.ndarray, int]:
    """
    Decode WAV bytes to mono float32.

    `audio/ingest.py` already delivers 16 kHz mono PCM, so the resample and
    downmix paths below are a safety net for direct callers (tests, the
    calibration script) rather than the normal case.
    """
    if not data:
        raise SignalError("EMPTY_AUDIO", "The recording contained no audio data.")

    try:
        samples, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception as exc:  # soundfile raises several unrelated types
        raise SignalError("INVALID_AUDIO", "That recording could not be decoded.") from exc

    if samples.size == 0:
        raise SignalError("EMPTY_AUDIO", "The recording contained no audio data.")

    mono = samples.mean(axis=1).astype(np.float32, copy=False)

    if sr != target_sr:
        import librosa  # local: only needed on the unusual path

        mono = librosa.resample(mono, orig_sr=sr, target_sr=target_sr)
        sr = target_sr

    return mono, sr


def condition(samples: np.ndarray) -> np.ndarray:
    """
    Remove DC and scale to a fixed peak.

    Peak normalisation is what makes recording level irrelevant. It matters
    more than it looks: several reference features are *relative* intensities
    (frication energy against the vowel in the same utterance), and those stay
    valid under any gain — which is precisely why they were chosen over
    absolute dB values that would not survive a different microphone.
    """
    signal = np.asarray(samples, dtype=np.float32)
    if signal.size == 0:
        return signal

    signal = signal - float(np.mean(signal))

    peak = float(np.max(np.abs(signal)))
    if peak > 0:
        # 0.95 rather than 1.0 so nothing downstream reads as clipped purely
        # because we normalised it.
        signal = signal * (0.95 / peak)

    return signal.astype(np.float32, copy=False)


def frame_rms(samples: np.ndarray) -> np.ndarray:
    """Per-frame RMS on the shared framing grid."""
    import librosa

    return librosa.feature.rms(
        y=samples, frame_length=WIN_LENGTH, hop_length=HOP_LENGTH, center=True
    )[0]


def find_speech(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> tuple[int, int]:
    """
    Locate the speech region with an adaptive energy gate.

    A fixed dB threshold fails in both directions — it clips the quiet tail of
    a /θ/ in a clean recording, and swallows the whole clip in a noisy one. So
    the threshold is placed between the clip's own noise floor and its own
    speech peak:

        threshold = floor + 0.15 * (peak - floor)          [in dB]

    The 15% figure is low on purpose. Under-trimming costs a little wasted
    analysis window; over-trimming deletes the target phoneme, which is the
    failure we cannot detect afterwards.

    Returns (start, end) in samples. Returns the full range when no gate can
    be placed, so callers always get a valid slice.
    """
    if samples.size == 0:
        return 0, 0

    rms = frame_rms(samples)
    if rms.size == 0:
        return 0, len(samples)

    db = 20.0 * np.log10(np.maximum(rms, 1e-10))

    # 10th percentile as the floor: robust to a brief click, and it does not
    # assume the recording actually contains silence.
    floor = float(np.percentile(db, 10))
    peak = float(np.max(db))
    if peak - floor < 6.0:
        # Less than 6 dB of range across the whole clip: either constant noise
        # or constant tone. There is no speech region to find.
        return 0, len(samples)

    threshold = floor + 0.15 * (peak - floor)
    voiced = np.flatnonzero(db > threshold)
    if voiced.size == 0:
        return 0, len(samples)

    #: Pad by one analysis window so a fricative onset is never cut in half.
    pad = WIN_LENGTH
    start = max(0, int(voiced[0]) * HOP_LENGTH - pad)
    end = min(len(samples), int(voiced[-1]) * HOP_LENGTH + pad)
    return start, end


def clipped_fraction(samples: np.ndarray) -> float:
    """Share of samples pinned at full scale. Must run before `condition`."""
    if samples.size == 0:
        return 0.0
    return float(np.mean(np.abs(samples) >= CLIP_THRESHOLD))


def prepare(data: bytes) -> Signal:
    """Decode, condition, and locate speech. The single entry point."""
    samples, sr = decode(data)
    return from_array(samples, sr)


def from_array(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> Signal:
    """Same pipeline, for callers that already hold samples (tests, calibration)."""
    conditioned = condition(samples)
    start, end = find_speech(conditioned, sample_rate)
    # Clipping is measured on the raw samples, over the speech region only.
    raw = np.asarray(samples, dtype=np.float32)
    clipping = clipped_fraction(raw[start:end] if end > start else raw)
    return Signal(
        samples=conditioned,
        sample_rate=sample_rate,
        speech_start=start,
        speech_end=end,
        clipped_fraction=clipping,
    )
