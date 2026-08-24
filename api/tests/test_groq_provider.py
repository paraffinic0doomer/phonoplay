"""
Unit tests for the Groq provider: response normalization and the full error
taxonomy. The network is replaced with httpx.MockTransport, so these are fast,
free, and deterministic — no API calls, no key needed.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.stt.base import AudioPayload
from app.stt.errors import (
    SttAuthError,
    SttBadResponse,
    SttInvalidAudio,
    SttNotConfigured,
    SttRateLimited,
    SttTimeout,
    SttUnavailable,
)
from app.stt.groq_provider import GroqSpeechToText, to_iso_639_1


def make_provider(handler, **kwargs) -> GroqSpeechToText:
    return GroqSpeechToText(
        api_key=kwargs.pop("api_key", "test-key"),
        model=kwargs.pop("model", "whisper-large-v3-turbo"),
        retry_backoff=0.0,
        max_retry_delay=0.0,
        transport=httpx.MockTransport(handler),
        **kwargs,
    )


AUDIO = AudioPayload(data=b"RIFF....fake wav bytes", filename="a.wav", mime_type="audio/wav")


# ── Normalization ────────────────────────────────────────────────────


async def test_normalizes_real_groq_response(groq_verbose_json):
    provider = make_provider(lambda req: httpx.Response(200, json=groq_verbose_json))

    result = await provider.transcribe(AUDIO, language="en", prompt="sun")

    assert result.transcript == "Sun"  # leading space stripped
    assert result.language == "English"
    assert result.language_code == "en"
    assert result.duration == pytest.approx(1.6144, abs=1e-3)
    assert result.provider.name == "groq"
    assert result.provider.model == "whisper-large-v3-turbo"
    assert result.provider.latency_ms >= 0

    # The two-stage contract is carried in the payload itself.
    assert result.stage == "transcription"
    assert result.pronunciation_assessed is False


async def test_folds_flat_word_list_into_segments(groq_verbose_json):
    """Groq returns words at the top level; we attach them to their segment."""
    provider = make_provider(lambda req: httpx.Response(200, json=groq_verbose_json))

    result = await provider.transcribe(AUDIO)

    assert len(result.segments) == 1
    words = result.segments[0].words
    assert [w.word for w in words] == ["Sun"]
    assert words[0].start == pytest.approx(0.18)
    assert words[0].end == pytest.approx(0.44)
    # The convenience accessor flattens them back out.
    assert [w.word for w in result.words] == ["Sun"]


async def test_keeps_words_when_segments_are_missing():
    """Short clips sometimes return words but no segments."""
    body = {
        "text": " red",
        "language": "English",
        "duration": 0.8,
        "words": [{"word": "red", "start": 0.1, "end": 0.5}],
    }
    provider = make_provider(lambda req: httpx.Response(200, json=body))

    result = await provider.transcribe(AUDIO)

    assert len(result.segments) == 1
    assert [w.word for w in result.segments[0].words] == ["red"]
    assert result.segments[0].start == pytest.approx(0.1)


async def test_empty_transcription_is_not_an_error():
    """Silence transcribes to nothing. That is a result, not a failure."""
    provider = make_provider(
        lambda req: httpx.Response(200, json={"text": "", "language": "English", "duration": 1.0})
    )

    result = await provider.transcribe(AUDIO)

    assert result.transcript == ""
    assert result.segments == []


async def test_sends_expected_request_shape():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = request.content.decode("latin1")
        return httpx.Response(200, json={"text": "sun"})

    provider = make_provider(handler)
    await provider.transcribe(AUDIO, language="en", prompt="sun")

    assert seen["url"].endswith("/audio/transcriptions")
    assert seen["auth"] == "Bearer test-key"
    body = seen["body"]
    assert 'name="model"' in body and "whisper-large-v3-turbo" in body
    assert "verbose_json" in body
    # Word timings must be requested explicitly.
    assert "timestamp_granularities[]" in body and "word" in body
    assert 'name="language"' in body and "en" in body
    assert 'name="prompt"' in body


# ── Error taxonomy ───────────────────────────────────────────────────


async def test_missing_key_fails_before_any_request():
    called = False

    def handler(request):
        nonlocal called
        called = True
        return httpx.Response(200, json={"text": "x"})

    provider = make_provider(handler, api_key="")

    with pytest.raises(SttNotConfigured):
        await provider.transcribe(AUDIO)
    assert called is False


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, SttAuthError),
        (403, SttAuthError),
        (400, SttInvalidAudio),
        (415, SttInvalidAudio),
        (413, SttInvalidAudio),
        (404, SttBadResponse),
    ],
)
async def test_client_errors_map_to_codes(status, expected):
    body = {"error": {"message": "nope"}}
    provider = make_provider(lambda req: httpx.Response(status, json=body))

    with pytest.raises(expected):
        await provider.transcribe(AUDIO)


async def test_rate_limit_reports_retry_after():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(429, headers={"retry-after": "2"}, json={"error": {"message": "slow down"}})

    provider = make_provider(handler)

    with pytest.raises(SttRateLimited) as info:
        await provider.transcribe(AUDIO)

    assert info.value.retry_after == 2.0
    assert info.value.retryable is True
    assert info.value.http_status == 429
    # One retry, not a storm.
    assert calls == 2


async def test_retries_transient_failure_exactly_once():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503, json={"error": {"message": "upstream"}})
        return httpx.Response(200, json={"text": " sun", "language": "English"})

    provider = make_provider(handler)
    result = await provider.transcribe(AUDIO)

    assert result.transcript == "sun"
    assert calls == 2


async def test_gives_up_after_one_retry():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(500, json={"error": {"message": "boom"}})

    provider = make_provider(handler)

    with pytest.raises(SttUnavailable):
        await provider.transcribe(AUDIO)
    assert calls == 2


async def test_does_not_retry_a_client_error():
    """A rejected key or bad audio will not fix itself. Do not spend calls."""
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(401, json={"error": {"message": "bad key"}})

    provider = make_provider(handler)

    with pytest.raises(SttAuthError):
        await provider.transcribe(AUDIO)
    assert calls == 1


async def test_timeout_maps_to_stt_timeout():
    def handler(request):
        raise httpx.ReadTimeout("too slow", request=request)

    provider = make_provider(handler)

    with pytest.raises(SttTimeout) as info:
        await provider.transcribe(AUDIO)
    assert info.value.http_status == 504


async def test_connection_failure_maps_to_unavailable():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    provider = make_provider(handler)

    with pytest.raises(SttUnavailable):
        await provider.transcribe(AUDIO)


async def test_unparseable_body_is_reported_cleanly():
    provider = make_provider(lambda req: httpx.Response(200, content=b"<html>nope</html>"))

    with pytest.raises(SttBadResponse):
        await provider.transcribe(AUDIO)


async def test_error_messages_never_leak_the_key():
    provider = make_provider(
        lambda req: httpx.Response(401, json={"error": {"message": "Invalid API Key"}}),
        api_key="gsk_supersecret_do_not_leak",
    )

    with pytest.raises(SttAuthError) as info:
        await provider.transcribe(AUDIO)

    assert "gsk_supersecret_do_not_leak" not in str(info.value)


def test_language_code_mapping():
    assert to_iso_639_1("English") == "en"
    assert to_iso_639_1("es") == "es"
    assert to_iso_639_1("Klingon") is None
    assert to_iso_639_1(None) is None


def test_fixture_is_a_real_captured_response(groq_verbose_json):
    """Guards against the fixture drifting into something hand-written."""
    assert set(groq_verbose_json) >= {"text", "language", "duration", "segments", "words"}
    assert json.dumps(groq_verbose_json)  # serializable
