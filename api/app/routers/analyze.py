"""
POST /api/analyze — the transcription stage.

Flow:  upload → validate → normalize (ffmpeg) → provider → normalized result

What this endpoint does NOT do: assess pronunciation. It reports which words
were recognised. The acoustic comparison against the target phoneme is a
separate stage with a separate model, and combining them here would collapse
the two independent signals PhonoPlay depends on into one.
"""

from __future__ import annotations

import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from ..audio import ingest
from ..config import Settings, get_settings
from ..schemas import (
    ProcessedAudioMeta,
    ProcessingMeta,
    SourceAudioMeta,
    TranscriptionResponse,
)
from ..stt import AudioPayload, SpeechToTextProvider, get_provider

log = logging.getLogger(__name__)

router = APIRouter(tags=["analysis"])


def provider_dependency() -> SpeechToTextProvider:
    return get_provider()


@router.post(
    "/analyze",
    response_model=TranscriptionResponse,
    summary="Transcribe a pronunciation recording (stage 1 of 2)",
)
async def analyze(
    audio: Annotated[UploadFile, File(description="The recording, any browser format.")],
    settings: Annotated[Settings, Depends(get_settings)],
    provider: Annotated[SpeechToTextProvider, Depends(provider_dependency)],
    prompt_id: Annotated[str | None, Form()] = None,
    session_id: Annotated[str | None, Form()] = None,
    #: The word the learner was asked to say. Passed to Whisper as a decoding
    #: hint, which measurably helps on one-word clips.
    expected_text: Annotated[str | None, Form()] = None,
    language: Annotated[str | None, Form()] = None,
    # Client-measured capture metadata, preserved through normalization.
    client_mime_type: Annotated[str | None, Form()] = None,
    client_duration_s: Annotated[float | None, Form()] = None,
    client_sample_rate: Annotated[int | None, Form()] = None,
    client_channels: Annotated[int | None, Form()] = None,
    client_size_bytes: Annotated[int | None, Form()] = None,
) -> TranscriptionResponse:
    started = time.perf_counter()

    raw = await audio.read()

    # Raises AudioError, handled centrally in main.py.
    normalized = await ingest.normalize(raw, settings)
    ingest_ms = int((time.perf_counter() - started) * 1000)

    stt_started = time.perf_counter()
    # Raises SttError, handled centrally in main.py.
    result = await provider.transcribe(
        AudioPayload(
            data=normalized.data,
            filename=normalized.filename,
            mime_type=normalized.mime_type,
        ),
        language=language or settings.stt_language,
        prompt=expected_text,
    )
    transcription_ms = int((time.perf_counter() - stt_started) * 1000)
    total_ms = int((time.perf_counter() - started) * 1000)

    log.info(
        "analyze prompt=%s session=%s %.2fs audio -> %r (%s/%s, %dms)",
        prompt_id,
        session_id,
        normalized.duration_s,
        result.transcript[:60],
        result.provider.name,
        result.provider.model,
        transcription_ms,
    )

    return TranscriptionResponse(
        transcript=result.transcript,
        language=result.language,
        language_code=result.language_code,
        # The server measured this file; prefer it over the provider's figure.
        duration=normalized.duration_s or result.duration,
        segments=result.segments,
        audio=ProcessedAudioMeta(
            probed_duration_s=normalized.source.duration_s or None,
            probed_sample_rate=normalized.source.sample_rate,
            probed_channels=normalized.source.channels,
            codec=normalized.source.codec,
            container=normalized.source.format_name,
            sample_rate=normalized.sample_rate,
            channels=normalized.channels,
            duration_s=normalized.duration_s,
            size_bytes=len(normalized.data),
            transcoded=True,
        ),
        source=SourceAudioMeta(
            mime_type=client_mime_type,
            duration_s=client_duration_s,
            sample_rate=client_sample_rate,
            channels=client_channels,
            size_bytes=client_size_bytes,
        ),
        processing=ProcessingMeta(
            ingest_ms=ingest_ms,
            transcription_ms=transcription_ms,
            total_ms=total_ms,
            provider=result.provider.name,
            model=result.provider.model,
        ),
    )
