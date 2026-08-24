"""
The quality gate.

This runs before any scoring and can stop the pipeline outright. That is a
product decision, not a technical nicety: a similarity score computed on
noise is a number that looks exactly as real as a good one and means nothing.
Refusing to produce it is the whole point.

The gate also produces a continuous `factor` in [0, 1] that feeds the final
confidence, so a merely mediocre recording lowers our certainty rather than
being silently treated as a clean one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .frames import FrameSet
from .preprocess import Signal

#: SNR here is peak-speech to noise-floor, and the bounds are derived from
#: the reference profiles rather than picked.
#:
#: The quietest thing this stage has to measure is a dental fricative, which
#: our own profiles put at roughly -24 dB relative to the vowel peak of the
#: same word (/θ/ -24.0, /f/ -25.3 — see reference/profiles.json). So for a
#: /θ/ to sit above the noise at all, the speech peak has to clear the floor
#: by about that much: 30 dB is where full credit starts.
#:
#: The hard floor is 15 dB. Below that even a sibilant's spectral *shape* is
#: unreliable, and unreliable shape is the dangerous failure — broadband
#: noise flattens the spectrum, which is exactly how a noisy /s/ comes to
#: measure like a /t/. The gate is deliberately stricter than an
#: intelligibility threshold would be: a human can understand speech at 5 dB
#: SNR, but we are not trying to understand it, we are trying to measure the
#: shape of one 60 ms fricative. Refusing is the correct answer here, and a
#: confident wrong substitution is the outcome this bound exists to prevent.
SNR_FLOOR_DB = 15.0
SNR_CEILING_DB = 30.0

#: A recording with more than 5% of its samples pinned at full scale has lost
#: the spectral detail the whole stage depends on.
CLIPPING_LIMIT = 0.05

#: Shorter than this and a single English word cannot be in there.
MIN_SPEECH_S = 0.15
#: Full credit once there is a comfortable word's worth of speech.
GOOD_SPEECH_S = 0.30

#: All four MVP targets sit in words with a vowel, so a clip with essentially
#: no periodic frames does not contain one of our prompts. This is a property
#: of the prompt set, not of speech in general — see reference/README.md.
MIN_VOICED_FRACTION = 0.08
#: Speech modulates. A signal this flat across its whole length is a tone,
#: a hum, or room noise.
MIN_DYNAMIC_RANGE_DB = 8.0


@dataclass(frozen=True)
class QualityReport:
    duration_s: float
    speech_duration_s: float
    snr_db: float
    clipped_fraction: float
    voiced_fraction: float
    dynamic_range_db: float
    speech_present: bool
    ok: bool
    #: Continuous quality in [0, 1]; multiplied into the final confidence.
    factor: float
    warnings: list[str] = field(default_factory=list)
    #: Set when `ok` is False. Maps to a feedback code, never to a score.
    blocking_code: str | None = None


def _snr_db(frames: FrameSet) -> tuple[float, float]:
    """
    Speech-to-noise estimate, and the clip's dynamic range.

    Percentiles rather than a voice-activity detector: the 10th percentile
    frame is a good stand-in for the noise floor and the 95th for the speech
    level, and neither needs a threshold that could itself be wrong. The gap
    between them is what the gate actually cares about.
    """
    if frames.n == 0:
        return 0.0, 0.0
    noise = float(np.percentile(frames.db, 10))
    speech = float(np.percentile(frames.db, 95))
    return speech - noise, float(np.max(frames.db) - np.min(frames.db))


def _ramp(value: float, low: float, high: float) -> float:
    """Linear 0→1 credit between two documented bounds."""
    if high <= low:
        return 1.0
    return float(np.clip((value - low) / (high - low), 0.0, 1.0))


def assess(signal: Signal, frames: FrameSet) -> QualityReport:
    snr, dynamic_range = _snr_db(frames)

    speech_slice = frames.window(
        signal.speech_start / signal.sample_rate, signal.speech_end / signal.sample_rate
    )
    voiced = frames.voiced[speech_slice]
    voiced_fraction = float(np.mean(voiced)) if voiced.size else 0.0

    speech_s = signal.speech_duration_s
    warnings: list[str] = []
    blocking: str | None = None

    speech_present = voiced_fraction >= MIN_VOICED_FRACTION and dynamic_range >= MIN_DYNAMIC_RANGE_DB

    if not speech_present:
        blocking = "NO_SPEECH_DETECTED"
    elif speech_s < MIN_SPEECH_S:
        blocking = "AUDIO_TOO_SHORT"
    elif snr < SNR_FLOOR_DB:
        blocking = "AUDIO_TOO_NOISY"
    elif signal.clipped_fraction > CLIPPING_LIMIT:
        blocking = "AUDIO_CLIPPED"

    if snr < SNR_CEILING_DB and blocking != "AUDIO_TOO_NOISY":
        warnings.append("background noise is close to the speech level")
    if signal.clipped_fraction > 0.001 and blocking != "AUDIO_CLIPPED":
        warnings.append("the recording is slightly clipped")
    if speech_s < GOOD_SPEECH_S and blocking != "AUDIO_TOO_SHORT":
        warnings.append("the recording is very short")

    # Geometric mean: any single unusable dimension takes the whole factor to
    # zero, which is the behaviour we want. An arithmetic mean would let a
    # pristine SNR paper over a 40 ms clip.
    factor = float(
        np.cbrt(
            _ramp(snr, SNR_FLOOR_DB, SNR_CEILING_DB)
            * _ramp(-signal.clipped_fraction, -CLIPPING_LIMIT, 0.0)
            * _ramp(speech_s, MIN_SPEECH_S, GOOD_SPEECH_S)
        )
    )

    return QualityReport(
        duration_s=round(signal.duration_s, 3),
        speech_duration_s=round(speech_s, 3),
        snr_db=round(snr, 1),
        clipped_fraction=round(signal.clipped_fraction, 5),
        voiced_fraction=round(voiced_fraction, 3),
        dynamic_range_db=round(dynamic_range, 1),
        speech_present=speech_present,
        ok=blocking is None,
        factor=round(factor, 3),
        warnings=warnings,
        blocking_code=blocking,
    )
