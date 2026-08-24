"""
Feature extraction — target-specific by design.

The same numbers are not measured for every phoneme. Spectral centroid says
almost nothing useful about /l/, and F3 says nothing at all about /s/, so
each feature family measures what actually carries the distinction:

  Fricative family (/s/, /θ/, and their candidates /ʃ/, /f/, /t/)
      Where the frication energy sits, how wide and how flat it is, how loud
      it is *relative to the vowel in the same word*, and how long it lasts.

  Approximant family (/ɹ/, /l/, and candidate /w/)
      F1-F3 at the constriction, the F3-F2 distance, the formant transition
      slope, and the mid-band dip that a lateral produces.

Two choices worth stating plainly:

  * **Relative, not absolute, intensity.** `rel_intensity_db` compares the
    target segment against the loudest frame of the same utterance. Absolute
    dB would measure the microphone and the room. The relative figure is the
    single most useful feature for /s/ vs /θ/, because a dental fricative is
    roughly 15 dB quieter than a sibilant regardless of who is speaking.

  * **MFCCs are reported but not scored.** They are in the response because
    they are the standard summary of spectral shape and a reader may want
    them. They are excluded from the comparison deliberately: MFCCs encode
    speaker and channel as strongly as they encode phoneme, and with a
    reference corpus this small, scoring on them would measure how much the
    learner sounds like the reference voice. That is a real limitation of
    the reference data, and hiding it behind a feature that happens to
    improve separation on the reference set would be the wrong trade.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .constants import SIBILANT_SPLIT_HZ
from .formants import FormantTrack
from .frames import FrameSet
from .phonemes import APPROXIMANT, FRICATIVE, family_of
from .preprocess import Signal
from .segment import SegmentEstimate

#: Frication measurements ignore everything below this. Below ~500 Hz the
#: spectrum is dominated by voicing bleed and room rumble, neither of which
#: is part of the fricative.
FRICATION_FLOOR_HZ = 500.0

#: Bands for the mid-band energy measurement. Named for the lateral
#: antiresonance it was added to detect, but the corpus says it earns its
#: place for a different reason: /ɹ/ measures ~7 dB higher here than /l/ or
#: /w/, because a lowered F3 moves real energy into this band. It is kept for
#: the effect it demonstrably has, and the comment says which.
LATERAL_DIP_BAND = (1500.0, 3000.0)
LATERAL_REF_BANDS = ((800.0, 1500.0), (3000.0, 4500.0))

#: How far past the approximant to look for a release. English /l/ ends with
#: the tongue tip leaving the ridge, which is an abrupt spectral change; /w/
#: glides continuously into the vowel with no such discontinuity.
RELEASE_WINDOW_S = 0.060

N_MFCC = 13


@dataclass(frozen=True)
class FeatureSet:
    """Measured features plus everything needed to interpret them."""

    family: str
    #: Feature name -> measured value. Only finite values appear here; a
    #: feature the signal could not support is simply absent, and scoring
    #: treats absence as missing evidence rather than as a zero.
    values: dict[str, float]
    #: Reported, never scored. See the module docstring.
    mfcc: list[float] = field(default_factory=list)
    #: Speaker reference values used for normalisation, so a reader can see
    #: what the normalised features were divided by.
    speaker: dict[str, float] = field(default_factory=dict)
    #: Which estimator produced the formants, when they were used.
    formant_method: str | None = None


def _band_power(frames: FrameSet, window: slice, low: float, high: float) -> float:
    band = (frames.freqs >= low) & (frames.freqs < high)
    if not band.any():
        return 0.0
    return float((frames.magnitude[band, window] ** 2).mean())


def _mean_spectrum(frames: FrameSet, window: slice) -> np.ndarray:
    """Average power spectrum over a frame window."""
    return (frames.magnitude[:, window] ** 2).mean(axis=1)


def _fricative_features(
    signal: Signal, frames: FrameSet, seg: SegmentEstimate
) -> dict[str, float]:
    window = frames.window(seg.measure_start_s, seg.measure_end_s)
    spectrum = _mean_spectrum(frames, window)

    band = frames.freqs >= FRICATION_FLOOR_HZ
    freqs = frames.freqs[band]
    power = spectrum[band]
    total = float(power.sum())
    if total <= 0:
        return {}

    weights = power / total
    centroid = float((freqs * weights).sum())
    # Second moment about the centroid: the spread of the frication energy.
    bandwidth = float(np.sqrt(((freqs - centroid) ** 2 * weights).sum()))

    cumulative = np.cumsum(weights)
    rolloff = float(freqs[int(np.searchsorted(cumulative, 0.85))])

    # Wiener entropy. A dental or labiodental fricative is diffuse (flat);
    # a sibilant concentrates its energy and so is peakier.
    positive = np.maximum(power, 1e-12)
    flatness = float(np.exp(np.mean(np.log(positive))) / np.mean(positive))

    peak_hz = float(freqs[int(np.argmax(power))])

    # Spectral tilt: least-squares slope of the log spectrum, in dB per kHz.
    # /s/ rises toward its high-frequency plateau; /f/ and /θ/ are flat.
    db = 10.0 * np.log10(positive)
    khz = freqs / 1000.0
    tilt = float(np.polyfit(khz, db, 1)[0])

    high = float(power[freqs >= SIBILANT_SPLIT_HZ].sum())
    hf_ratio = high / total

    # Loudness of the frication relative to the loudest frame of the same
    # utterance — in practice, the vowel. Gain-invariant by construction.
    speech = frames.window(
        signal.speech_start / signal.sample_rate, signal.speech_end / signal.sample_rate
    )
    peak_db = float(np.max(frames.db[speech])) if frames.db[speech].size else 0.0
    segment_db = float(np.mean(frames.db[window])) if frames.db[window].size else peak_db

    return {
        "centroid_hz": centroid,
        "bandwidth_hz": bandwidth,
        "rolloff85_hz": rolloff,
        "flatness": flatness,
        "peak_hz": peak_hz,
        "tilt_db_per_khz": tilt,
        "hf_ratio": float(hf_ratio),
        "zcr": float(np.mean(frames.zcr[window])),
        "voicing": float(np.mean(frames.voicing[window])),
        "rel_intensity_db": segment_db - peak_db,
        "duration_s": float(seg.duration_s),
    }


def _speaker_reference(
    signal: Signal, frames: FrameSet, formants: FormantTrack
) -> dict[str, float]:
    """
    That speaker's own formant medians over the voiced frames of this
    utterance — in practice, their vowels.

    Absolute formant values vary enormously between an adult male and a
    child; F3 alone spans roughly 2.4-3.8 kHz across speakers, which is wider
    than the /ɹ/-/w/ difference we are trying to measure. Dividing by the
    speaker's own median removes most of that without needing to know
    anything about them, and it costs nothing.
    """
    speech = frames.window(
        signal.speech_start / signal.sample_rate, signal.speech_end / signal.sample_rate
    )
    mask = np.zeros(frames.n, dtype=bool)
    mask[speech] = frames.voiced[speech]

    f1, f2, f3 = formants.median_over(mask)
    out: dict[str, float] = {}
    for name, value in (("f1_hz", f1), ("f2_hz", f2), ("f3_hz", f3)):
        if np.isfinite(value):
            out[f"median_{name}"] = float(value)

    # Pitch is deliberately NOT reported. It is computed upstream (the
    # segmenter needs per-frame voicing) but it is not used by any reference
    # profile, and f0 is the single most age- and sex-correlated number this
    # stage can produce. Reporting an unused measurement of that kind for the
    # sake of completeness would be collecting something we have no use for.
    #
    # The formant medians above stay because they are load-bearing: F2 and F3
    # are divided by the speaker's median F3 to remove vocal-tract-length
    # variation. They are a normalisation denominator, and nothing infers
    # anything from them.
    return out


def _approximant_features(
    signal: Signal,
    frames: FrameSet,
    formants: FormantTrack,
    seg: SegmentEstimate,
    speaker: dict[str, float],
) -> dict[str, float]:
    measure = frames.window(seg.measure_start_s, seg.measure_end_s)
    span = frames.window(seg.start_s, seg.end_s)

    def median(values: np.ndarray) -> float | None:
        selected = values[measure]
        selected = selected[np.isfinite(selected)]
        return float(np.median(selected)) if selected.size else None

    f1 = median(formants.f1)
    f2 = median(formants.f2)
    f3 = median(formants.f3)

    out: dict[str, float] = {"duration_s": float(seg.duration_s)}
    if f1 is not None:
        out["f1_hz"] = f1
    if f2 is not None:
        out["f2_hz"] = f2
    if f3 is not None:
        out["f3_hz"] = f3

    if f2 is not None and f3 is not None:
        # The English /ɹ/ signature: F3 drops until it nearly meets F2.
        # /w/ keeps a wide gap, /l/ a moderate one.
        out["f3_minus_f2_hz"] = f3 - f2

    # Speaker normalisation, both formants divided by the *same* quantity:
    # the speaker's median F3.
    #
    # The obvious version — F2 over the speaker's median F2 — was tried first
    # and is wrong. Over a single short word the median F2 is set by that
    # word's vowel, not by the speaker, so /w/ in "walk" (back rounded vowel,
    # low median F2) normalised to 0.81 and measured exactly like /l/. F3 is
    # far more a property of vocal-tract length than of vowel quality, which
    # is what makes it a usable length proxy from one word of audio.
    reference = speaker.get("median_f3_hz")
    if reference:
        if f2 is not None:
            out["f2_over_speaker_f3"] = f2 / reference
        if f3 is not None:
            out["f3_over_speaker_f3"] = f3 / reference

    # F2 transition slope across the span. /w/ starts very low and rises
    # steeply into the vowel; /l/ and /ɹ/ move much less.
    trace = formants.f2[span]
    times = frames.times[span]
    valid = np.isfinite(trace)
    if valid.sum() >= 3:
        out["f2_slope_hz_per_s"] = float(
            np.polyfit(times[valid], trace[valid], 1)[0]
        )

    dip = _band_power(frames, measure, *LATERAL_DIP_BAND)
    neighbours = np.mean([_band_power(frames, measure, *b) for b in LATERAL_REF_BANDS])
    if dip > 0 and neighbours > 0:
        out["mid_dip_db"] = float(10.0 * np.log10(dip / neighbours))

    flux = _release_flux(frames, seg)
    if flux is not None:
        out["release_flux"] = flux

    return out


def _release_flux(frames: FrameSet, seg: SegmentEstimate) -> float | None:
    """
    The sharpest spectral change as the approximant gives way to the vowel.

    Successive frame spectra are normalised to unit sum and compared by total
    variation distance, so the result is in [0, 1] and independent of gain:

        flux(t) = ½ · Σ_f |p_t(f) - p_{t-1}(f)|

    A lateral releases — the tongue tip leaves the ridge and the spectrum
    steps. A glide does not.
    """
    window = frames.window(seg.end_s, seg.end_s + RELEASE_WINDOW_S)
    start = max(window.start - 1, 0)
    block = frames.magnitude[:, start : window.stop] ** 2
    if block.shape[1] < 2:
        return None

    totals = block.sum(axis=0)
    if np.any(totals <= 0):
        return None

    normalized = block / totals
    return float(0.5 * np.abs(np.diff(normalized, axis=1)).sum(axis=0).max())


def _mfcc(signal: Signal, seg: SegmentEstimate) -> list[float]:
    import librosa

    clip = signal.slice_s(seg.measure_start_s, seg.measure_end_s)
    if clip.size < 256:
        clip = signal.slice_s(seg.start_s, seg.end_s)
    if clip.size < 256:
        return []

    # 40 mel bands, not the librosa default of 128: at a 256-point FFT and
    # 16 kHz there are only 129 bins, so 128 bands would leave most of the
    # filterbank empty.
    coefficients = librosa.feature.mfcc(
        y=np.ascontiguousarray(clip),
        sr=signal.sample_rate,
        n_mfcc=N_MFCC,
        n_fft=256,
        hop_length=128,
        n_mels=40,
    )
    return [round(float(v), 3) for v in coefficients.mean(axis=1)]


def extract(
    target: str,
    signal: Signal,
    frames: FrameSet,
    formants: FormantTrack,
    seg: SegmentEstimate,
) -> FeatureSet:
    """Measure the features that matter for `target` over the located segment."""
    family = family_of(target)

    if family == FRICATIVE:
        values = _fricative_features(signal, frames, seg)
        speaker: dict[str, float] = {}
        method = None
    elif family == APPROXIMANT:
        speaker = _speaker_reference(signal, frames, formants)
        values = _approximant_features(signal, frames, formants, seg, speaker)
        method = formants.method
    else:  # pragma: no cover - guarded by phonemes.spec
        raise ValueError(f"no feature extractor for family {family!r}")

    clean = {k: round(float(v), 4) for k, v in values.items() if np.isfinite(v)}
    return FeatureSet(
        family=family,
        values=clean,
        mfcc=_mfcc(signal, seg),
        speaker={k: round(v, 1) for k, v in speaker.items()},
        formant_method=method,
    )
