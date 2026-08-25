"""
Integration tests for POST /api/analyze.

These drive the real FastAPI app end to end — multipart upload, ffmpeg
transcode, provider call, response serialization, error envelopes — with only
the provider's network replaced. ffmpeg genuinely runs, on genuine audio.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app import stt
from app.config import Settings, get_settings
from app.main import app
from app.stt.errors import SttRateLimited, SttTimeout
from app.stt.fake_provider import FakeSpeechToText
from app.stt.groq_provider import GroqSpeechToText


@pytest.fixture
def client():
    """App wired to the offline provider."""
    provider = FakeSpeechToText(transcript="sun")
    app.dependency_overrides[get_settings] = lambda: Settings(
        stt_provider="fake", groq_api_key="test-key"
    )
    stt.set_provider(provider)
    with TestClient(app) as test_client:
        # TestClient's lifespan rebuilds the provider; pin ours back.
        stt.set_provider(provider)
        test_client.provider = provider  # type: ignore[attr-defined]
        yield test_client
    app.dependency_overrides.clear()
    stt.set_provider(None)


def post_audio(client: TestClient, data: bytes, filename: str, mime: str, **form):
    return client.post(
        "/api/analyze",
        files={"audio": (filename, data, mime)},
        data={k: str(v) for k, v in form.items()},
    )


# ── Happy path ───────────────────────────────────────────────────────


def test_transcribes_a_wav_upload(client, speech_wav):
    response = post_audio(client, speech_wav, "attempt.wav", "audio/wav")

    assert response.status_code == 200
    body = response.json()

    assert body["transcript"] == "sun"
    assert body["language_code"] == "en"
    assert body["duration"] == pytest.approx(1.61, abs=0.05)
    assert body["segments"][0]["words"][0]["word"] == "sun"


def test_transcribes_the_container_chrome_actually_sends(client, speech_webm):
    """WebM/Opus in, normalized WAV out. No assumption that browsers send WAV."""
    response = post_audio(client, speech_webm, "attempt.webm", "audio/webm;codecs=opus")

    assert response.status_code == 200
    audio = response.json()["audio"]

    assert audio["codec"] == "opus"
    assert "webm" in (audio["container"] or "")
    # Normalized for the provider.
    assert audio["sample_rate"] == 16000
    assert audio["channels"] == 1
    assert audio["transcoded"] is True
    # And the provider really was handed WAV.
    assert client.provider.calls[0]["mime_type"] == "audio/wav"


def test_response_declares_it_is_not_a_pronunciation_score(client, speech_wav):
    """The two-stage separation is part of the contract, not just a doc."""
    body = post_audio(client, speech_wav, "a.wav", "audio/wav").json()

    assert body["stage"] == "transcription"
    assert body["pronunciation_assessed"] is False
    # No scoring fields may appear on this endpoint.
    for forbidden in ("score", "scores", "gop", "deviation", "similarity"):
        assert forbidden not in body


def test_preserves_client_capture_metadata(client, speech_webm):
    response = post_audio(
        client,
        speech_webm,
        "attempt.webm",
        "audio/webm;codecs=opus",
        client_mime_type="audio/webm;codecs=opus",
        client_duration_s=1.622,
        client_sample_rate=48000,
        client_channels=1,
        client_size_bytes=len(speech_webm),
        prompt_id="s_word_001",
        session_id="sess-1",
    )

    source = response.json()["source"]
    assert source["mime_type"] == "audio/webm;codecs=opus"
    assert source["sample_rate"] == 48000
    assert source["duration_s"] == pytest.approx(1.622)

    # The server's own measurement is reported separately, not overwritten.
    audio = response.json()["audio"]
    assert audio["probed_sample_rate"] == 48000
    assert audio["sample_rate"] == 16000


def test_reports_processing_metadata(client, speech_wav):
    processing = post_audio(client, speech_wav, "a.wav", "audio/wav").json()["processing"]

    assert processing["provider"] == "fake"
    assert processing["model"] == "fake-1"
    assert processing["ingest_ms"] >= 0
    assert processing["total_ms"] >= processing["transcription_ms"]


def test_expected_text_is_passed_to_the_provider_as_a_hint(client, speech_wav):
    post_audio(client, speech_wav, "a.wav", "audio/wav", expected_text="sun")

    assert client.provider.calls[0]["prompt"] == "sun"
    assert client.provider.calls[0]["language"] == "en"


def test_silence_returns_a_result_not_an_error(client, silence_wav):
    """A silent clip is a legitimate transcription outcome."""
    client.provider._transcript = ""
    response = post_audio(client, silence_wav, "a.wav", "audio/wav")

    assert response.status_code == 200
    assert response.json()["transcript"] == ""


# ── Invalid audio ────────────────────────────────────────────────────


def test_rejects_non_audio_bytes(client, not_audio):
    response = post_audio(client, not_audio, "a.bin", "application/octet-stream")

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] in {"INVALID_AUDIO", "NO_AUDIO_STREAM"}
    assert error["retryable"] is False
    # Nothing was spent on the provider.
    assert client.provider.calls == []


def test_rejects_an_empty_upload(client):
    response = post_audio(client, b"", "a.wav", "audio/wav")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "EMPTY_AUDIO"
    assert client.provider.calls == []


def test_rejects_a_clip_that_is_too_short(client, tiny_wav):
    response = post_audio(client, tiny_wav, "a.wav", "audio/wav")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "AUDIO_TOO_SHORT"
    assert client.provider.calls == []


def test_missing_file_is_a_clean_422(client):
    response = client.post("/api/analyze", data={"prompt_id": "x"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


# ── Provider failures surface as clean envelopes ─────────────────────


def test_rate_limit_becomes_429_with_retry_after(client, speech_wav):
    client.provider._raise_error = SttRateLimited("slow down", retry_after=3)

    response = post_audio(client, speech_wav, "a.wav", "audio/wav")

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "STT_RATE_LIMITED"
    assert response.json()["error"]["retryable"] is True
    assert response.headers["retry-after"] == "3"


def test_timeout_becomes_504(client, speech_wav):
    client.provider._raise_error = SttTimeout("too slow")

    response = post_audio(client, speech_wav, "a.wav", "audio/wav")

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "STT_TIMEOUT"
    assert response.json()["error"]["retryable"] is True


def test_unexpected_errors_do_not_leak_internals(speech_wav):
    class Exploding(FakeSpeechToText):
        async def transcribe(self, *a, **k):
            raise RuntimeError("secret internal detail gsk_leak")

    app.dependency_overrides[get_settings] = lambda: Settings(
        stt_provider="fake", groq_api_key="test-key"
    )
    # raise_server_exceptions=False makes TestClient return what a real server
    # would return instead of re-raising the exception into the test.
    with TestClient(app, raise_server_exceptions=False) as client:
        stt.set_provider(Exploding())
        response = post_audio(client, speech_wav, "a.wav", "audio/wav")

    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "INTERNAL_ERROR",
            "message": "Something went wrong on the server.",
            "retryable": True,
        }
    }
    assert "gsk_leak" not in response.text
    assert "secret internal detail" not in response.text
    app.dependency_overrides.clear()
    stt.set_provider(None)


# ── Ops ──────────────────────────────────────────────────────────────


def test_health_reports_readiness_without_exposing_the_key(client):
    body = client.get("/api/health").json()

    assert body["status"] in {"ok", "degraded"}
    assert body["stt"]["configured"] is True
    assert body["audio"]["ffmpeg"] is True
    assert "test-key" not in client.get("/api/health").text


def test_scoring_endpoint_validates_the_real_multipart_contract(client):
    """The implemented scoring endpoint rejects an incomplete request cleanly."""
    response = client.post("/api/attempts")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_provider_registry_returns_the_configured_backend():
    assert isinstance(
        stt.build_provider(Settings(stt_provider="fake")), FakeSpeechToText
    )
    assert isinstance(
        stt.build_provider(Settings(stt_provider="groq", groq_api_key="k")),
        GroqSpeechToText,
    )
    with pytest.raises(ValueError):
        stt.build_provider(Settings(stt_provider="nope"))


def test_no_module_outside_stt_imports_groq():
    """The abstraction is only worth having if nothing routes around it."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    # Real coupling = importing the module or naming the class/host. Mentioning
    # Groq in a comment (e.g. "Groq recommends 16 kHz") is not coupling.
    markers = ("groq_provider", "GroqSpeechToText", "api.groq.com")
    offenders = []
    for path in root.rglob("*.py"):
        # app/stt/ is where Groq is allowed to exist. config.py is exempt
        # because provider settings (key, model, base URL) are configuration,
        # not call sites — the point of the guard is that no *logic* outside
        # app/stt/ talks to Groq.
        if path.parent.name == "stt" or path.name == "config.py":
            continue
        text = path.read_text(encoding="utf-8")
        code = "\n".join(
            line for line in text.splitlines() if not line.lstrip().startswith("#")
        )
        if any(marker in code for marker in markers):
            offenders.append(str(path.relative_to(root)))
    assert offenders == [], f"Groq coupling outside app/stt/: {offenders}"


def test_httpx_is_only_reached_through_the_provider():
    """Guards against a stray direct call to the transcription API."""
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1] / "app"
    offenders = [
        str(path.relative_to(root))
        for path in root.rglob("*.py")
        if path.parent.name != "stt" and "audio/transcriptions" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_mock_transport_is_wired_correctly():
    """Sanity check on the test harness itself."""
    provider = GroqSpeechToText(
        api_key="k",
        model="m",
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"text": "ok"})),
    )
    assert provider.name == "groq"


def test_an_attempt_reports_whether_a_sound_was_actually_named(
    client, monkeypatch, lace_wav
):
    """
    `scores.overall` is a real similarity measurement and stays populated even
    when the stage declines to name a sound — the number is not a lie, it just
    is not a verdict. `assessed` is what tells a caller which of the two it is
    holding.

    Without it the response contradicts itself: `deviation.type` reads
    "inconclusive" and the explanation says "Unable to confidently assess this
    attempt", while `scores.overall` sits there at 86.9 waiting for a UI to
    render it as a percentage.
    """
    request = {
        "files": {"audio": ("a.wav", lace_wav, "audio/wav")},
        "data": {"prompt_id": "l_word_lion", "session_id": "assessed-flag"},
    }

    assessed = client.post("/api/attempts", **request).json()
    assert assessed["assessed"] is True
    assert assessed["deviation"]["type"] != "inconclusive"

    # Raise the floor past anything a recording can reach: same audio, same
    # measurement, no verdict.
    monkeypatch.setattr("app.acoustic.scoring.CONFIDENCE_FLOOR", 1.01)
    uncertain = client.post("/api/attempts", **request).json()

    assert uncertain["assessed"] is False
    assert uncertain["deviation"]["type"] == "inconclusive"
    assert uncertain["deviation"]["to"] is None
    # The measurement is still reported; only the verdict is withheld.
    assert uncertain["scores"]["target_sound"] > 0


def test_an_unassessed_attempt_stays_out_of_the_progress_series(
    client, monkeypatch, lace_wav
):
    """A recording we declined to score must not become a point on a graph."""
    monkeypatch.setattr("app.acoustic.scoring.CONFIDENCE_FLOOR", 1.01)
    client.post(
        "/api/attempts",
        files={"audio": ("a.wav", lace_wav, "audio/wav")},
        data={"prompt_id": "l_word_lion", "session_id": "no-series"},
    )

    series = client.get("/api/progress", params={"session_id": "no-series"}).json()
    points = series.get("points") or series.get("series") or []
    assert points == [], points
