"""
Wire schemas for the PhonoPlay API.

This module is the source of truth for the contract; `web/src/types/api.ts`
mirrors it by hand. Change both in the same commit.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .stt.base import Segment


class SourceAudioMeta(BaseModel):
    """What the browser said it captured, before any server-side conversion."""

    mime_type: str | None = None
    duration_s: float | None = None
    sample_rate: int | None = None
    channels: int | None = None
    size_bytes: int | None = None


class ProcessedAudioMeta(BaseModel):
    """What the server measured and produced."""

    #: ffprobe's reading of the uploaded bytes.
    probed_duration_s: float | None = None
    probed_sample_rate: int | None = None
    probed_channels: int | None = None
    codec: str | None = None
    container: str | None = None
    #: The normalized form actually sent to the provider.
    sample_rate: int
    channels: int
    duration_s: float
    size_bytes: int
    transcoded: bool = True


class ProcessingMeta(BaseModel):
    """Where the wall-clock went. Useful for tuning, and honest about cost."""

    ingest_ms: int
    transcription_ms: int
    total_ms: int
    provider: str
    model: str


class TranscriptionResponse(BaseModel):
    """
    POST /api/analyze.

    STAGE 1 ONLY. This is what was said, not how it was pronounced.
    `pronunciation_assessed` is False in every response and is part of the
    contract: no consumer may read a transcript as a pronunciation score.
    The acoustic stage (ARCHITECTURE.md §3.3–3.5) is a separate endpoint and
    a separate model.
    """

    transcript: str
    #: Provider's own label, e.g. "English".
    language: str | None = None
    #: ISO-639-1 when derivable, else null.
    language_code: str | None = None
    duration: float | None = None
    segments: list[Segment] = Field(default_factory=list)

    audio: ProcessedAudioMeta
    source: SourceAudioMeta | None = None
    processing: ProcessingMeta

    stage: str = "transcription"
    pronunciation_assessed: bool = False


class ErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    """Every non-2xx response uses this envelope."""

    error: ErrorBody


class HealthResponse(BaseModel):
    status: str
    version: str
    stt: "SttHealth"
    audio: "AudioHealth"


class SttHealth(BaseModel):
    provider: str
    model: str
    configured: bool


class AudioHealth(BaseModel):
    ffmpeg: bool


HealthResponse.model_rebuild()


# ── Stage 2: acoustic pronunciation analysis (POST /api/pronunciation) ──
#
# Mirrors app/acoustic/analyzer.py::PronunciationAnalysis. Kept in a separate
# response model from TranscriptionResponse on purpose: the two stages measure
# different things from the same audio, and a single merged object would make
# it easy to read a transcript as evidence about a phoneme.


class SegmentInfo(BaseModel):
    """Where in the recording the target sound was estimated to be."""

    start_s: float
    end_s: float
    duration_s: float
    #: [0, 1]. How clearly the landmark stood out. Feeds the confidence.
    salience: float
    #: Which detector found it, e.g. "frication-run", "voiced-onset".
    method: str
    position_hint: str


class QualityInfo(BaseModel):
    duration_s: float
    speech_duration_s: float
    snr_db: float
    clipped_fraction: float
    voiced_fraction: float
    dynamic_range_db: float
    speech_present: bool
    ok: bool
    #: [0, 1]. Multiplied into the confidence.
    factor: float
    warnings: list[str] = Field(default_factory=list)
    blocking_code: str | None = None


class CandidateInfo(BaseModel):
    """One phoneme the recording was compared against."""

    phoneme: str
    ipa: str
    similarity: float
    posterior: float
    features_used: int
    #: Per-feature standardised error. This is what makes the verdict
    #: auditable — a reader can see which measurement drove it.
    z_scores: dict[str, float] = Field(default_factory=dict)


class PronunciationResponse(BaseModel):
    """
    POST /api/pronunciation.

    STAGE 2. Everything here is derived from the acoustic signal. No field is
    influenced by the transcript, and no field may be produced by a language
    model — see ARCHITECTURE.md §14.
    """

    target_phoneme: str
    target_ipa: str
    #: null when the evidence did not support naming a sound. Never guessed.
    estimated_match: str | None = None
    estimated_match_ipa: str | None = None
    #: Gaussian similarity to the target profile, in (0, 1].
    similarity_score: float
    #: [0, 1]. Below the floor, `estimated_match` is null and `assessed` false.
    confidence: float
    acoustic_features: dict[str, float] = Field(default_factory=dict)
    feedback_code: str

    message: str
    #: The specific reason behind a failure headline. `message` stays fixed
    #: on every failure so it cannot read as a score; this carries the cause.
    detail: str | None = None
    cue: str | None = None
    hint: str | None = None
    #: False whenever no phoneme was named, for any reason.
    assessed: bool = False

    candidates: list[CandidateInfo] = Field(default_factory=list)
    segment: SegmentInfo | None = None
    quality: QualityInfo
    #: Speaker reference values used for normalisation.
    speaker: dict[str, float] = Field(default_factory=dict)
    #: Reported for transparency, deliberately not scored on. See
    #: app/acoustic/features.py.
    mfcc: list[float] = Field(default_factory=list)
    reference: dict = Field(default_factory=dict)
    processing_ms: int = 0
    stage: str = "acoustic"
