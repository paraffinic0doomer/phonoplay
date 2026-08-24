"""GET /api/health — readiness, including whether the STT key is present."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from ..audio import ingest
from ..config import Settings, get_settings
from ..schemas import AudioHealth, HealthResponse, SttHealth

router = APIRouter(tags=["ops"])


@router.get("/health", response_model=HealthResponse, summary="Service readiness")
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    configured = bool(settings.groq_api_key) or settings.stt_provider == "fake"
    ffmpeg = ingest.ffmpeg_available(settings)
    return HealthResponse(
        status="ok" if (configured and ffmpeg) else "degraded",
        version="0.1.0",
        # The key itself is never exposed — only whether one is present.
        stt=SttHealth(
            provider=settings.stt_provider,
            model=settings.groq_model,
            configured=configured,
        ),
        audio=AudioHealth(ffmpeg=ffmpeg),
    )
