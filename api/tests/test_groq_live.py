"""
Live integration test — makes a REAL Groq API call.

Skipped unless GROQ_LIVE_TEST=1 and a key is configured, so the default test
run costs nothing. Run it when the provider contract might have moved:

    GROQ_LIVE_TEST=1 python -m pytest tests/test_groq_live.py -v

Two clips, ~1.6 s each. Groq bills a 10-second minimum per request, so this
is deliberately small and not parametrized over many files.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app import stt
from app.audio import ingest
from app.config import Settings, get_settings
from app.main import app
from app.stt.base import AudioPayload

LIVE = os.getenv("GROQ_LIVE_TEST") == "1"
HAS_KEY = bool(Settings().groq_api_key)

pytestmark = pytest.mark.skipif(
    not (LIVE and HAS_KEY),
    reason="set GROQ_LIVE_TEST=1 with GROQ_API_KEY configured to run live tests",
)


async def test_live_transcribes_real_speech(speech_wav):
    """The provider, against the real service, on real speech."""
    settings = Settings()
    provider = stt.build_provider(settings)
    try:
        normalized = await ingest.normalize(speech_wav, settings)
        result = await provider.transcribe(
            AudioPayload(
                data=normalized.data,
                filename=normalized.filename,
                mime_type=normalized.mime_type,
            ),
            language="en",
            prompt="sun",
        )
    finally:
        await provider.aclose()

    assert "sun" in result.transcript.lower()
    assert result.language_code == "en"
    assert result.duration == pytest.approx(1.6, abs=0.3)
    assert result.provider.name == "groq"
    assert result.provider.model == settings.groq_model
    assert result.provider.latency_ms > 0

    # Word timings are the reason we ask for verbose_json.
    words = result.words
    assert words, "expected word-level timings"
    assert words[0].start is not None and words[0].end is not None
    assert 0 <= words[0].start < words[0].end <= result.duration + 0.5

    # Still stage 1 only.
    assert result.pronunciation_assessed is False


async def test_live_handles_browser_webm(speech_webm):
    """The container Chrome actually uploads, end to end."""
    settings = Settings()
    provider = stt.build_provider(settings)
    try:
        normalized = await ingest.normalize(speech_webm, settings)
        assert normalized.mime_type == "audio/wav"  # transcoded before sending
        result = await provider.transcribe(
            AudioPayload(
                data=normalized.data,
                filename=normalized.filename,
                mime_type=normalized.mime_type,
            ),
            language="en",
        )
    finally:
        await provider.aclose()

    assert result.transcript.strip() != ""


def test_live_endpoint_end_to_end(speech_webm):
    """The full HTTP path: multipart upload -> ffmpeg -> Groq -> JSON."""
    app.dependency_overrides[get_settings] = lambda: Settings()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/analyze",
                files={"audio": ("attempt.webm", speech_webm, "audio/webm;codecs=opus")},
                data={
                    "expected_text": "sun",
                    "prompt_id": "s_word_001",
                    "client_mime_type": "audio/webm;codecs=opus",
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    body = response.json()

    assert "sun" in body["transcript"].lower()
    assert body["language_code"] == "en"
    assert body["audio"]["codec"] == "opus"
    assert body["audio"]["sample_rate"] == 16000
    assert body["processing"]["provider"] == "groq"
    assert body["processing"]["transcription_ms"] > 0
    assert body["pronunciation_assessed"] is False
