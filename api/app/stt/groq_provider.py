"""
Groq implementation of SpeechToTextProvider.

Groq serves Whisper over an OpenAI-compatible endpoint:
POST {base_url}/audio/transcriptions, multipart, with `verbose_json` giving
segments and (when asked) word-level timings.

This is the ONLY module in the codebase that knows Groq exists. Everything
else depends on `SpeechToTextProvider` and `Transcription`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from .base import (
    AudioPayload,
    ProviderInfo,
    Segment,
    SpeechToTextProvider,
    Transcription,
    Word,
)
from .languages import to_iso_639_1
from .errors import (
    SttAuthError,
    SttBadResponse,
    SttInvalidAudio,
    SttNotConfigured,
    SttRateLimited,
    SttTimeout,
    SttUnavailable,
)

log = logging.getLogger(__name__)


class GroqSpeechToText(SpeechToTextProvider):
    name = "groq"

    def __init__(
        self,
        *,
        api_key: str,
        api_keys: list[str] | None = None,
        model: str,
        base_url: str = "https://api.groq.com/openai/v1",
        connect_timeout: float = 5.0,
        read_timeout: float = 30.0,
        max_retries: int = 1,
        retry_backoff: float = 0.75,
        max_retry_delay: float = 5.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_keys = [key.strip() for key in (api_keys or [api_key]) if key.strip()]
        self._api_key = self._api_keys[0] if self._api_keys else ""
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._max_retries = max(0, max_retries)
        self._retry_backoff = retry_backoff
        self._max_retry_delay = max_retry_delay
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                read_timeout, connect=connect_timeout, write=read_timeout, pool=connect_timeout
            ),
            # `transport` is how tests substitute a fake network without
            # patching module globals.
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def transcribe(
        self,
        audio: AudioPayload,
        *,
        language: str | None = None,
        prompt: str | None = None,
    ) -> Transcription:
        if not self._api_key:
            raise SttNotConfigured(
                "GROQ_API_KEY is not set, so transcription is unavailable."
            )

        url = f"{self._base_url}/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self._api_key}"}

        data: dict[str, Any] = {
            "model": self._model,
            "response_format": "verbose_json",
            # Word timings require verbose_json. We ask for both granularities
            # so the acoustic stage can later be pointed at a word window.
            "timestamp_granularities[]": ["word", "segment"],
            "temperature": "0",
        }
        if language:
            data["language"] = language
        if prompt:
            # Groq caps the prompt at 224 tokens; ours is a single word.
            data["prompt"] = prompt[:400]

        attempt = 0
        key_attempts = 0
        started = asyncio.get_running_loop().time()

        while True:
            try:
                response = await self._client.post(
                    url,
                    headers=headers,
                    data=data,
                    files={"file": (audio.filename, audio.data, audio.mime_type)},
                )
            except httpx.TimeoutException as exc:
                if attempt < self._max_retries:
                    attempt += 1
                    await self._sleep_before_retry(attempt, None)
                    continue
                raise SttTimeout(
                    "The transcription service did not respond in time."
                ) from exc
            except httpx.HTTPError as exc:
                if attempt < self._max_retries:
                    attempt += 1
                    await self._sleep_before_retry(attempt, None)
                    continue
                raise SttUnavailable(
                    "Could not reach the transcription service."
                ) from exc

            if response.status_code == 200:
                latency_ms = int((asyncio.get_running_loop().time() - started) * 1000)
                return self._normalize(response, latency_ms)

            # Transient: one retry, then give up.
            if response.status_code in (401, 403, 429) and key_attempts + 1 < len(self._api_keys):
                key_attempts += 1
                self._api_key = self._api_keys[key_attempts]
                log.warning("groq key rejected or exhausted; rotating to pool key %d", key_attempts + 1)
                continue

            if response.status_code == 429 or response.status_code >= 500:
                retry_after = _retry_after_seconds(response)
                if attempt < self._max_retries:
                    attempt += 1
                    await self._sleep_before_retry(attempt, retry_after)
                    continue
                if response.status_code == 429:
                    raise SttRateLimited(
                        "The transcription service is rate limited. "
                        "Wait a moment and try again.",
                        retry_after=retry_after,
                    )
                raise SttUnavailable(
                    f"The transcription service returned {response.status_code}."
                )

            raise self._client_error(response)

    async def _sleep_before_retry(self, attempt: int, retry_after: float | None) -> None:
        delay = retry_after if retry_after is not None else self._retry_backoff * attempt
        delay = min(delay, self._max_retry_delay)
        log.warning("groq transcribe retry %s in %.2fs", attempt, delay)
        await asyncio.sleep(delay)

    def _client_error(self, response: httpx.Response) -> Exception:
        detail = _error_message(response)
        if response.status_code in (401, 403):
            return SttAuthError(f"The transcription service rejected our key: {detail}")
        if response.status_code == 413:
            return SttInvalidAudio("The recording is too large to transcribe.")
        if response.status_code in (400, 415, 422):
            return SttInvalidAudio(f"The recording could not be transcribed: {detail}")
        return SttBadResponse(
            f"Unexpected response from the transcription service "
            f"({response.status_code}): {detail}"
        )

    def _normalize(self, response: httpx.Response, latency_ms: int) -> Transcription:
        """Map Groq's verbose_json onto our provider-neutral shape."""
        try:
            body = response.json()
        except ValueError as exc:
            raise SttBadResponse("The transcription service returned invalid JSON.") from exc

        if not isinstance(body, dict):
            raise SttBadResponse("The transcription service returned an unexpected shape.")

        transcript = (body.get("text") or "").strip()

        # Word timings arrive as a flat top-level list. Fold them into the
        # segment whose time range contains them so callers get one structure.
        loose_words = [
            Word(
                word=str(item.get("word", "")).strip(),
                start=_as_float(item.get("start")),
                end=_as_float(item.get("end")),
            )
            for item in body.get("words") or []
            if isinstance(item, dict)
        ]

        segments: list[Segment] = []
        for index, raw in enumerate(body.get("segments") or []):
            if not isinstance(raw, dict):
                continue
            start = _as_float(raw.get("start")) or 0.0
            end = _as_float(raw.get("end")) or start
            segments.append(
                Segment(
                    id=int(raw.get("id", index)),
                    start=start,
                    end=end,
                    text=str(raw.get("text", "")).strip(),
                    words=[
                        word
                        for word in loose_words
                        if word.start is not None and start - 1e-6 <= word.start < end + 1e-6
                    ],
                    avg_logprob=_as_float(raw.get("avg_logprob")),
                    no_speech_prob=_as_float(raw.get("no_speech_prob")),
                    compression_ratio=_as_float(raw.get("compression_ratio")),
                )
            )

        # Short clips sometimes come back with words but no segments. Keep the
        # timings rather than silently dropping them.
        if not segments and loose_words:
            starts = [w.start for w in loose_words if w.start is not None]
            ends = [w.end for w in loose_words if w.end is not None]
            segments = [
                Segment(
                    id=0,
                    start=min(starts) if starts else 0.0,
                    end=max(ends) if ends else 0.0,
                    text=transcript,
                    words=loose_words,
                )
            ]

        language = body.get("language") or None
        return Transcription(
            transcript=transcript,
            language=language,
            language_code=to_iso_639_1(language),
            duration=_as_float(body.get("duration")),
            segments=segments,
            provider=ProviderInfo(
                name=self.name, model=self._model, latency_ms=latency_ms
            ),
        )


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _retry_after_seconds(response: httpx.Response) -> float | None:
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None


def _error_message(response: httpx.Response) -> str:
    """Groq nests its message under {"error": {"message": ...}}."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:200] or "no detail"
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])[:300]
        if body.get("message"):
            return str(body["message"])[:300]
    return "no detail"
