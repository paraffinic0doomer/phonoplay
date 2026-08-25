"""
POST /api/pronunciation — the acoustic pronunciation analysis (stage 2).

Flow:  upload → validate → normalize (ffmpeg) → acoustic analysis → result

Separate from `/api/analyze` on purpose. That endpoint reports which words a
speech-to-text model recognised; this one measures how a specific sound was
produced. They take the same audio and answer different questions, and
merging them would invite exactly the confusion PhonoPlay is built to avoid —
a clean transcript is not a clean /r/, because speech-to-text repairs
mispronunciations toward real English words.

Nothing in this endpoint's response comes from a language model.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile

from ..acoustic import ONSET, TARGETS, analyze as run_analysis
from ..acoustic.preprocess import SignalError
from ..audio import ingest
from ..config import Settings, get_settings
from ..schemas import PronunciationResponse
from ..stt.errors import AudioError

log = logging.getLogger(__name__)

router = APIRouter(tags=["analysis"])

_POSITIONS = {"onset", "coda", "medial"}


async def assess(
    audio_bytes: bytes,
    target_sound: str,
    settings: Settings,
    *,
    expected_text: str | None = None,
    position: str = ONSET,
) -> PronunciationResponse:
    """
    Normalize then analyse. Shared with the journey router, which needs the
    same measurement to decide whether a learner advances.

    Raises:
        AudioError: the upload is unusable. Handled centrally in main.py.
    """
    if target_sound not in TARGETS:
        raise AudioError(
            "UNSUPPORTED_TARGET",
            f"{target_sound!r} is not a practice target. "
            f"Supported: {', '.join(TARGETS)}.",
            http_status=422,
            retryable=False,
        )
    if position not in _POSITIONS:
        position = ONSET

    normalized = await ingest.normalize(audio_bytes, settings)

    try:
        # The analysis is CPU-bound numpy and takes tens of milliseconds.
        # Off the event loop so one attempt cannot stall concurrent requests.
        analysis = await asyncio.to_thread(
            run_analysis,
            normalized.data,
            target_sound,
            expected_text=expected_text,
            position=position,
        )
    except SignalError as exc:
        # Reaching here means ffmpeg produced something the decoder refused,
        # which should not happen — surfaced rather than swallowed.
        raise AudioError(exc.code, exc.message, http_status=422) from exc

    # `segment_info` on the dataclass, `segment` on the wire. Without the
    # rename the field silently arrived as null: Pydantic ignored the unknown
    # key and filled the declared one with its default, so every response
    # claimed no segment was located even when one was.
    payload = analysis.__dict__ | {"segment": analysis.segment_info}
    payload.pop("segment_info", None)
    return PronunciationResponse(**payload)


@router.post(
    "/pronunciation",
    response_model=PronunciationResponse,
    summary="Measure how a target sound was produced (stage 2 of 2)",
)
async def pronunciation(
    audio: Annotated[UploadFile, File(description="The recording, any browser format.")],
    settings: Annotated[Settings, Depends(get_settings)],
    target_sound: Annotated[str, Form(description="One of: s, r, l, th")],
    #: The word the learner was asked to say. Used for labelling and logs
    #: only — no part of the score depends on it.
    expected_text: Annotated[str | None, Form()] = None,
    #: Where the target sits in that word, from the prompt bank. Narrows the
    #: search; never decides the answer.
    position: Annotated[str, Form()] = ONSET,
    prompt_id: Annotated[str | None, Form()] = None,
    session_id: Annotated[str | None, Form()] = None,
) -> PronunciationResponse:
    raw = await audio.read()
    result = await assess(
        raw,
        target_sound,
        settings,
        expected_text=expected_text,
        position=position,
    )

    log.info(
        "pronunciation target=%s prompt=%s session=%s -> %s (%s, conf=%.2f)",
        target_sound,
        prompt_id,
        session_id,
        result.estimated_match,
        result.feedback_code,
        result.confidence,
    )
    return result
