"""
The contracts the speech-to-text stage has to keep.

Three separate promises are checked here, none of which is about whether
Whisper transcribes well:

  1. A malformed provider response is a classified failure, never a crash.
  2. The API key never leaves the server, in any form.
  3. Transcription and pronunciation analysis stay separate, and the
     speech-to-text model is never used as though it were a chat model.

The network is httpx.MockTransport throughout, so these are fast, free, and
need no key.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

import httpx
import pytest

from app.stt import build_provider, get_provider, set_provider
from app.stt.base import (
    AudioPayload,
    SpeechToTextProvider,
    Transcription,
)
from app.stt.errors import SttBadResponse, SttError
from app.stt.groq_provider import GroqSpeechToText

APP = Path(__file__).resolve().parents[1] / "app"
AUDIO = AudioPayload(data=b"RIFF....fake wav bytes", filename="a.wav", mime_type="audio/wav")


def provider_returning(body, status: int = 200) -> GroqSpeechToText:
    return GroqSpeechToText(
        api_key="gsk_test_secret_key_value",
        model="whisper-large-v3-turbo",
        retry_backoff=0.0,
        max_retry_delay=0.0,
        transport=httpx.MockTransport(lambda request: httpx.Response(status, json=body)),
    )


# ── 1. A malformed 200 is a classified failure ───────────────────────
#
# These all escaped as AttributeError or ValueError before, which reached the
# client as a bare 500 with no code the frontend could switch on.


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"text": ["a"], "segments": []}, id="transcript-is-a-list"),
        pytest.param({"text": 5, "segments": []}, id="transcript-is-a-number"),
        pytest.param({"text": {"a": 1}}, id="transcript-is-an-object"),
        pytest.param([1, 2, 3], id="body-is-a-list"),
        pytest.param("hello", id="body-is-a-string"),
    ],
)
async def test_malformed_body_raises_bad_response(body):
    with pytest.raises(SttBadResponse):
        await provider_returning(body).transcribe(AUDIO)


def test_a_non_text_transcript_is_never_coerced():
    """
    str(["a"]) would produce the transcript "['a']".

    A fabricated transcript is worse than a reported failure: downstream it is
    indistinguishable from something the learner actually said.
    """
    source = inspect.getsource(GroqSpeechToText._build)
    assert "raise SttBadResponse" in source
    assert "str(raw_text)" not in source


@pytest.mark.parametrize(
    "body,expected_segments",
    [
        pytest.param({"text": "hi", "segments": "nope"}, 0, id="segments-is-a-string"),
        pytest.param({"text": "hi", "segments": {"a": 1}}, 0, id="segments-is-an-object"),
        pytest.param({"text": "hi", "segments": [[1, 2]]}, 0, id="segment-is-a-list"),
        pytest.param({"text": "hi", "words": "nope", "segments": []}, 0, id="words-is-a-string"),
        pytest.param(
            {"text": "hi", "segments": [{"id": "abc", "start": 0, "end": 1, "text": "hi"}]},
            1,
            id="segment-id-is-not-an-int",
        ),
        pytest.param(
            {"text": "hi", "words": [{"word": None, "start": "x"}], "segments": []},
            1,
            id="word-entry-malformed",
        ),
        pytest.param({"text": "hi", "duration": "abc", "segments": []}, 0, id="duration-is-a-string"),
        pytest.param({"text": "hi", "language": 7, "segments": []}, 0, id="language-is-a-number"),
    ],
)
async def test_recoverable_junk_degrades_instead_of_failing(body, expected_segments):
    """
    Metadata is optional; the transcript is not.

    A junk segment id or an unparseable duration must not throw away a
    transcript the learner is waiting on.
    """
    result = await provider_returning(body).transcribe(AUDIO)
    assert result.transcript == "hi"
    assert len(result.segments) == expected_segments


async def test_a_missing_language_is_none_not_a_guess():
    result = await provider_returning({"text": "hi", "language": 7}).transcribe(AUDIO)
    assert result.language is None
    assert result.language_code is None


async def test_every_failure_is_an_stt_error():
    """No provider failure may reach a router as an unclassified exception."""
    hostile = [
        {"text": ["a"]},
        {"text": 5},
        [1, 2, 3],
        "hello",
        {"segments": [{"id": "x"}]},
        {"text": "hi", "segments": [{"id": 0, "start": "a", "end": "b", "text": 1}]},
        {},
    ]
    for body in hostile:
        try:
            await provider_returning(body).transcribe(AUDIO)
        except SttError:
            pass  # classified, which is the requirement
        except Exception as exc:  # pragma: no cover - the thing being prevented
            pytest.fail(f"{body!r} escaped as {type(exc).__name__}: {exc}")


# ── 2. The key never leaves the server ───────────────────────────────

SECRET = "gsk_test_secret_key_value"


async def test_the_key_is_absent_from_a_successful_result():
    result = await provider_returning(
        {"text": "sun", "language": "English", "duration": 1.0, "segments": []}
    ).transcribe(AUDIO)
    assert SECRET not in result.model_dump_json()
    assert SECRET not in repr(result)


@pytest.mark.parametrize("status", [400, 401, 403, 413, 422, 429, 500, 503])
async def test_the_key_is_absent_from_every_error(status):
    provider = provider_returning({"error": {"message": "boom"}}, status=status)
    try:
        await provider.transcribe(AUDIO)
    except SttError as exc:
        assert SECRET not in str(exc)
        assert SECRET not in repr(exc)
    else:  # pragma: no cover
        pytest.fail(f"status {status} did not raise")


def test_the_key_is_sent_as_a_header_not_a_query_string():
    """A key in a URL lands in access logs and proxy caches."""
    source = inspect.getsource(GroqSpeechToText.transcribe)
    assert 'headers = {"Authorization": f"Bearer {self._api_key}"}' in source
    assert "api_key=" not in source


def test_no_key_is_readable_from_the_frontend():
    """
    The browser bundle may name Groq - the privacy disclosure has to say who
    receives the audio - but it must never carry a credential.
    """
    web = APP.parents[1] / "web" / "src"
    if not web.exists():  # pragma: no cover - backend-only checkouts
        pytest.skip("frontend not present")
    for path in web.rglob("*.ts*"):
        text = path.read_text(encoding="utf-8", errors="replace")
        assert "gsk_" not in text, f"{path} contains something shaped like a Groq key"
        assert "GROQ_API_KEY" not in text, f"{path} references the server-side key"


# ── 3. Transcription is not pronunciation analysis ───────────────────


def test_transcription_carries_no_pronunciation_fields():
    """
    Whisper repairs mispronunciations toward plausible English: say "wabbit"
    and it may write "rabbit". Nothing on this model may look like a score.
    """
    banned = re.compile(
        r"(score|similarity|accuracy|mastery|rating|grade|correct|pronunciation_quality)",
        re.I,
    )
    for name in Transcription.model_fields:
        if name == "pronunciation_assessed":
            continue  # the explicit disclaimer, not a score
        assert not banned.search(name), f"Transcription.{name} reads like a score"


async def test_the_payload_says_it_is_not_an_assessment():
    result = await provider_returning({"text": "sun", "segments": []}).transcribe(AUDIO)
    assert result.stage == "transcription"
    assert result.pronunciation_assessed is False
    # And it survives serialization, so a consumer reading the wire sees it.
    assert '"pronunciation_assessed":false' in result.model_dump_json().replace(" ", "")


def test_the_speech_model_is_never_sent_to_a_chat_endpoint():
    """
    groq_model is Whisper. Sending it to /chat/completions returns a 400 that
    the caller's except-block swallows, so the endpoint silently degrades to a
    hard-coded fallback forever. That is exactly what happened to
    llm/exercise.py, and it is invisible without this test.
    """
    offenders = []
    for path in APP.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="replace")
        if "chat/completions" not in text and "groq_chat_model" not in text:
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if "settings.groq_model" in line or '"model": settings.groq_model' in line:
                offenders.append(f"{path.relative_to(APP)}:{number}")
    assert not offenders, (
        "the speech-to-text model is being used in a chat request at: "
        + ", ".join(offenders)
    )


def test_chat_callers_leave_room_for_the_reasoning_trace():
    """
    gpt-oss-120b emits a reasoning trace before its JSON. With too small a
    budget the request dies as json_validate_failed with an empty generation -
    which the callers swallow. Measured need for these prompts: ~630 tokens.
    """
    for path in APP.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="replace")
        if "chat/completions" not in text:
            continue
        for budget in re.findall(r'"max_tokens":\s*(\d+)', text):
            assert int(budget) >= 800, (
                f"{path.relative_to(APP)} allows only {budget} completion tokens, "
                "which is below what the reasoning trace alone consumes"
            )


# ── The abstraction holds ────────────────────────────────────────────


def executable_source(path: Path) -> str:
    """
    The file with its docstrings and comments removed.

    Prose that explains why the two stages are separate - or that names who
    receives the audio - is documentation, not a dependency. Only real code
    counts as reaching past the abstraction.
    """
    import ast

    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        tree = ast.parse(text)
    except SyntaxError:  # pragma: no cover
        return text

    prose: set[int] = set()
    for node in ast.walk(tree):
        # A bare string expression is a docstring wherever it appears.
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            if isinstance(node.value.value, str) and node.end_lineno:
                prose.update(range(node.lineno, node.end_lineno + 1))

    return "\n".join(
        line
        for number, line in enumerate(text.splitlines(), 1)
        if number not in prose and not line.strip().startswith("#")
    )


def test_only_the_provider_module_names_groq():
    """
    The rest of the application talks to SpeechToTextProvider.

    Config, startup, and the health endpoint are allowed to name the backend
    because selecting and reporting it is their job. The LLM modules talk to a
    different Groq surface (/chat/completions) and are a separate concern from
    speech-to-text. Everything else must go through the abstraction.
    """
    allowed = {
        Path("config.py"),
        Path("routers/health.py"),
        Path("main.py"),
        Path("journey/material.py"),
        Path("llm/exercise.py"),
        Path("safety.py"),
    }
    offenders = []
    for path in APP.rglob("*.py"):
        relative = path.relative_to(APP)
        # The stt package is where the backend is allowed to be known.
        if relative.parts[0] == "stt" or relative in allowed:
            continue
        code = executable_source(path).lower()
        if "groq" in code or "whisper" in code:
            offenders.append(str(relative))
    assert not offenders, f"these modules reach past the abstraction: {offenders}"


def test_the_boundary_check_can_actually_fail():
    """A guard that cannot fire is not a guard."""
    import textwrap

    sample = APP / "audio" / "ingest.py"
    assert "groq" in sample.read_text(encoding="utf-8").lower()
    assert "groq" not in executable_source(sample).lower()

    forged = textwrap.dedent(
        '''
        """A docstring mentioning Groq."""
        # a comment mentioning Groq
        client.post("https://api.groq.com/v1")
        '''
    )
    tmp = APP / "_boundary_probe.py"
    tmp.write_text(forged, encoding="utf-8")
    try:
        assert "groq" in executable_source(tmp).lower()
    finally:
        tmp.unlink()


def test_the_registry_returns_the_abstraction():
    set_provider(None)
    try:
        provider = build_provider()
        assert isinstance(provider, SpeechToTextProvider)
        # transcribe is the whole interface. Nothing else is promised.
        assert hasattr(provider, "transcribe")
        assert hasattr(provider, "aclose")
    finally:
        set_provider(None)


def test_the_provider_is_built_once_and_reused():
    set_provider(None)
    try:
        assert get_provider() is get_provider()
    finally:
        set_provider(None)


def test_an_unknown_provider_name_fails_loudly():
    from app.config import Settings

    with pytest.raises(ValueError, match="Unknown STT_PROVIDER"):
        build_provider(Settings(stt_provider="not-a-real-provider"))
