"""
PhonoPlay analysis service.

Two independent analysis stages over the same recording:

  * stage 1, transcription   -> POST /api/analyze        (app/stt/)
  * stage 2, acoustic        -> POST /api/pronunciation  (app/acoustic/)

and the adaptive practice progression built on top of stage 2
(app/journey/, POST /api/journey/*). See ARCHITECTURE.md sections 13-15.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .acoustic import warmup as acoustic_warmup
from .audio import ingest
from .config import get_settings
from .safety import public_notice
from .journey.store import JourneyStore, set_store
from .routers import (
    analyze,
    attempts,
    catalog,
    exercises,
    health,
    journey,
    progress,
    pronunciation,
)
from .stt import AudioError, SttError, build_provider, set_provider

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("phonoplay")

VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    # Build the provider once. Later this is also where the acoustic models
    # get preloaded — a cold first request is a dead demo.
    provider = build_provider(settings)
    set_provider(provider)

    if not settings.groq_api_key and settings.stt_provider == "groq":
        log.warning("GROQ_API_KEY is not set — /api/analyze will return 503.")
    if not ingest.ffmpeg_available(settings):
        log.warning("ffmpeg not found on PATH — audio ingest will fail.")

    # Load the reference profiles and warm the JIT paths librosa compiles on
    # first use. A cold first request costs a second or more, which on a
    # 2-second clip is the difference between instant and broken.
    acoustic_warmup()

    # Journey progress outlives the process, so the store is opened once here
    # and closed on shutdown. It holds outcomes only — never audio.
    store = JourneyStore(settings.journey_db_path)
    set_store(store)

    log.info(
        "PhonoPlay API %s ready (stt=%s model=%s)",
        VERSION,
        settings.stt_provider,
        settings.groq_model,
    )
    try:
        yield
    finally:
        await provider.aclose()
        set_provider(None)
        store.close()
        set_store(None)


app = FastAPI(
    title="PhonoPlay API",
    version=VERSION,
    description=(
        "Pronunciation practice analysis. Transcription and acoustic "
        "pronunciation evidence are separate signals."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _error(status: int, code: str, message: str, retryable: bool) -> JSONResponse:
    """Single error envelope for every failure. Mirrors ErrorResponse."""
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "retryable": retryable}},
    )


@app.exception_handler(SttError)
async def handle_stt_error(_: Request, exc: SttError) -> JSONResponse:
    log.warning("stt error %s: %s", exc.code, exc.message)
    response = _error(exc.http_status, exc.code, exc.message, exc.retryable)
    if exc.retry_after is not None:
        response.headers["Retry-After"] = str(int(exc.retry_after))
    return response


@app.exception_handler(AudioError)
async def handle_audio_error(_: Request, exc: AudioError) -> JSONResponse:
    log.info("audio rejected %s: %s", exc.code, exc.message)
    return _error(exc.http_status, exc.code, exc.message, exc.retryable)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return _error(
        422,
        "INVALID_REQUEST",
        f"The request was malformed: {exc.errors()[0].get('msg', 'invalid input')}",
        False,
    )


@app.exception_handler(Exception)
async def handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
    # Never leak internals (or a key) to the browser.
    log.exception("unhandled error", exc_info=exc)
    return _error(500, "INTERNAL_ERROR", "Something went wrong on the server.", True)


@app.get("/api/safety", tags=["safety"], summary="What PhonoPlay claims, and what it does not")
async def safety() -> dict:
    """
    The product's standing disclosures: the disclaimer, the fixed wordings
    used when it cannot assess a recording, where audio goes at each stage,
    and what it explicitly does not claim.

    Served from `app/safety.py`, which is the single place these strings are
    defined, so the interface and the tests cannot drift apart from each
    other or from the pipeline they describe.
    """
    return public_notice()


app.include_router(health.router, prefix="/api")
app.include_router(analyze.router, prefix="/api")
app.include_router(pronunciation.router, prefix="/api")
app.include_router(catalog.router, prefix="/api")
app.include_router(attempts.router, prefix="/api")
app.include_router(progress.router, prefix="/api")
app.include_router(exercises.router, prefix="/api")
app.include_router(journey.router, prefix="/api")
