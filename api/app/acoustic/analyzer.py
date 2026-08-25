"""
Stage 2 — the acoustic pronunciation analysis, end to end.

    audio bytes
      -> preprocess      decode, DC-remove, peak-normalise, find the speech
      -> frames          one shared set of short-time measurements
      -> quality gate    stop here if the recording cannot support a verdict
      -> segment         estimate where the target sound is
      -> features        measure what distinguishes that target
      -> scoring         compare against the target and its alternatives
      -> feedback        say what was measured, and what to try next

Every stage can decline. A clip with no speech never reaches segmentation; a
clip with no locatable landmark never reaches scoring; a scored clip with a
weak margin still returns `estimated_match: null`. There is no path through
this module that produces a number without audio behind it.

This stage is independent of transcription. It does not read the transcript,
does not know what the speech-to-text provider heard, and would return the
same result if that stage had never run. The expected word is used only as a
label in the response and, through the prompt bank, to say where in the word
the target sits.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from . import feedback as fb
from . import features as feat
from . import formants as fm
from . import frames as fr
from . import preprocess, profiles, scoring, segment
from .phonemes import TARGETS, spec
from .quality import QualityReport, assess

log = logging.getLogger(__name__)

#: A phoneme was named, with evidence behind it.
STATUS_ASSESSED = "assessed"
#: Usable audio, but the evidence did not support naming a phoneme. This is a
#: real answer, not a failure - forcing a classification here is exactly what
#: this stage must not do.
STATUS_UNCERTAIN = "insufficient_confidence"
#: The recording itself could not support a verdict: silence, noise, clipping,
#: nothing locatable.
STATUS_UNUSABLE = "unusable_audio"


@dataclass(frozen=True)
class PronunciationAnalysis:
    """
    The result of stage 2.

    The five fields the product contract names — `target_phoneme`,
    `estimated_match`, `similarity_score`, `confidence`, `acoustic_features`,
    `feedback_code` — are all here, alongside the evidence behind them.
    Nothing is a summary of something the caller cannot also inspect.
    """

    target_phoneme: str
    #: The phoneme the recording measured most like, or None when the
    #: evidence did not support naming one. Never guessed to fill the field.
    estimated_match: str | None
    #: Gaussian similarity to the *target* profile, in (0, 1].
    similarity_score: float
    #: How much the analysis trusts its own verdict, in [0, 1].
    confidence: float
    acoustic_features: dict[str, float]
    feedback_code: str
    #: One word for what happened, for callers that only need to branch.
    #:
    #: ``assessed``                a phoneme was named
    #: ``insufficient_confidence`` the recording was usable, the evidence was
    #:                             not strong enough to name one
    #: ``unusable_audio``          the recording could not support any verdict
    #:
    #: This says the same thing as ``assessed`` plus ``feedback_code``, in a
    #: single field. It is derived from them, never set independently, so the
    #: two can never disagree.
    status: str = STATUS_UNUSABLE

    #: Everything below is evidence, not verdict.
    target_ipa: str = ""
    estimated_match_ipa: str | None = None
    message: str = ""
    #: The specific reason behind a failure headline, when there is one.
    detail: str | None = None
    cue: str | None = None
    hint: str | None = None
    assessed: bool = False
    candidates: list[dict] = field(default_factory=list)
    segment_info: dict | None = None
    quality: dict = field(default_factory=dict)
    speaker: dict = field(default_factory=dict)
    mfcc: list[float] = field(default_factory=list)
    reference: dict = field(default_factory=dict)
    processing_ms: int = 0
    #: Always "acoustic". The counterpart to the transcription stage's
    #: "transcription", so no consumer can confuse the two signals.
    stage: str = "acoustic"


def _blocked(
    target: str,
    code: str,
    quality: QualityReport,
    started: float,
    reference: dict,
    segment_info: dict | None = None,
) -> PronunciationAnalysis:
    """A result that stops before scoring. Carries no score, by construction."""
    message = fb.for_blocked(code)
    return PronunciationAnalysis(
        target_phoneme=target,
        target_ipa=spec(target).ipa,
        estimated_match=None,
        # 0.0, not a low-but-nonzero number: nothing was compared, so there is
        # no similarity to report. A small positive value would read as a
        # measurement.
        similarity_score=0.0,
        confidence=0.0,
        acoustic_features={},
        feedback_code=code,
        message=message.message,
        detail=message.detail,
        cue=message.cue,
        hint=message.cue,
        assessed=False,
        quality=quality.__dict__ | {"warnings": list(quality.warnings)},
        segment_info=segment_info,
        reference=reference,
        processing_ms=int((time.perf_counter() - started) * 1000),
    )


def analyze(
    audio: bytes,
    target: str,
    *,
    expected_text: str | None = None,
    position: str = segment.ONSET,
) -> PronunciationAnalysis:
    """
    Assess one recording against one target sound.

    Args:
        audio: WAV bytes, normally 16 kHz mono from `audio/ingest.py`.
        target: one of `phonemes.TARGETS`.
        expected_text: the word the learner was asked to say. Used for
            labelling only — no part of the score depends on it.
        position: where the target sits in that word, from the prompt bank.

    Raises:
        ValueError: `target` is not a supported practice target.
        preprocess.SignalError: the bytes are not decodable audio.
    """
    if target not in TARGETS:
        raise ValueError(
            f"{target!r} is not a practice target; supported: {', '.join(TARGETS)}"
        )

    started = time.perf_counter()
    reference_set = profiles.load()
    reference_info = {
        "version": reference_set.version,
        "built": reference_set.built,
        "tokens": reference_set.provenance.get("tokens"),
        "source": reference_set.provenance.get("source"),
    }

    signal = preprocess.prepare(audio)
    frames = fr.analyse(signal.samples)

    quality = assess(signal, frames)
    if not quality.ok:
        return _blocked(
            target, quality.blocking_code or fb.UNABLE_TO_ASSESS, quality, started, reference_info
        )

    # Formants are only needed for the approximant family, but the tracker is
    # cheap and the speaker reference it produces is useful either way.
    formants = fm.track(signal.samples, frames.times)

    located = segment.locate(target, signal, frames, formants, position=position)
    if located is None:
        return _blocked(target, fb.TARGET_NOT_LOCATED, quality, started, reference_info)

    measured = feat.extract(target, signal, frames, formants, located)
    result = scoring.score(
        target,
        measured,
        reference_set,
        quality=quality.factor,
        salience=located.salience,
    )

    if result.estimated_match is None:
        message = fb.for_uncertain(target, result.inconclusive_reason)
    else:
        message = fb.for_verdict(target, result.estimated_match, result.similarity_score)

    segment_info = {
        "start_s": located.start_s,
        "end_s": located.end_s,
        "duration_s": round(located.duration_s, 4),
        "salience": located.salience,
        "method": located.method,
        "position_hint": position,
    }

    analysis = PronunciationAnalysis(
        target_phoneme=target,
        target_ipa=spec(target).ipa,
        estimated_match=result.estimated_match,
        estimated_match_ipa=spec(result.estimated_match).ipa if result.estimated_match else None,
        similarity_score=result.similarity_score,
        confidence=result.confidence,
        acoustic_features=measured.values,
        feedback_code=message.code,
        message=message.message,
        detail=message.detail,
        cue=message.cue,
        hint=message.hint,
        assessed=result.estimated_match is not None,
        status=(
            STATUS_ASSESSED
            if result.estimated_match is not None
            else STATUS_UNCERTAIN
        ),
        candidates=[
            {
                "phoneme": c.phoneme,
                "ipa": c.ipa,
                "similarity": c.similarity,
                "posterior": c.posterior,
                "features_used": c.features_used,
                "z_scores": c.z_scores,
            }
            for c in result.candidates
        ],
        segment_info=segment_info,
        quality=quality.__dict__ | {"warnings": list(quality.warnings)},
        speaker=measured.speaker,
        mfcc=measured.mfcc,
        reference=reference_info | {
            "margin": result.margin,
            "coverage": result.coverage,
            "formant_method": measured.formant_method,
            "inconclusive_reason": result.inconclusive_reason,
        },
        processing_ms=int((time.perf_counter() - started) * 1000),
    )

    log.info(
        "acoustic target=%s expected=%r -> match=%s sim=%.2f conf=%.2f (%s, %dms)",
        target,
        expected_text,
        analysis.estimated_match,
        analysis.similarity_score,
        analysis.confidence,
        analysis.feedback_code,
        analysis.processing_ms,
    )
    return analysis


def warmup() -> None:
    """
    Load the reference set and touch every hot code path once.

    Called at startup. The first numba-jitted librosa call costs a second or
    more; paying it before the first learner records is the difference
    between a demo that feels instant and one that stalls.
    """
    import numpy as np

    profiles.load()
    tone = (0.05 * np.sin(2 * np.pi * 220 * np.arange(8000) / 16000)).astype(np.float32)
    signal = preprocess.from_array(tone)
    frames = fr.analyse(signal.samples)
    fm.track(signal.samples, frames.times)
    assess(signal, frames)
