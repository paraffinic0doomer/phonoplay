"""
Offline provider for tests and for running the app without a Groq key.

It does no speech recognition. It echoes a scripted transcript so routing,
validation, error handling, and serialization can be exercised without
spending API calls. Selected only when STT_PROVIDER=fake.
"""

from __future__ import annotations

import asyncio

from .base import (
    AudioPayload,
    ProviderInfo,
    Segment,
    SpeechToTextProvider,
    Transcription,
    Word,
)
from .errors import SttError


class FakeSpeechToText(SpeechToTextProvider):
    name = "fake"

    def __init__(
        self,
        *,
        transcript: str = "sun",
        language: str = "en",
        duration: float = 1.2,
        latency_ms: int = 5,
        raise_error: SttError | None = None,
    ) -> None:
        self._transcript = transcript
        self._language = language
        self._duration = duration
        self._latency_ms = latency_ms
        self._raise_error = raise_error
        #: Recording of what it was asked to do, for assertions.
        self.calls: list[dict[str, object]] = []

    async def transcribe(
        self,
        audio: AudioPayload,
        *,
        language: str | None = None,
        prompt: str | None = None,
    ) -> Transcription:
        self.calls.append(
            {
                "size_bytes": audio.size_bytes,
                "filename": audio.filename,
                "mime_type": audio.mime_type,
                "language": language,
                "prompt": prompt,
            }
        )
        await asyncio.sleep(0)

        if self._raise_error is not None:
            raise self._raise_error

        words = self._transcript.split()
        span = self._duration / max(len(words), 1)
        timed = [
            Word(word=word, start=round(i * span, 3), end=round((i + 1) * span, 3))
            for i, word in enumerate(words)
        ]

        return Transcription(
            transcript=self._transcript,
            language=language or self._language,
            duration=self._duration,
            segments=[
                Segment(
                    id=0,
                    start=0.0,
                    end=self._duration,
                    text=self._transcript,
                    words=timed,
                    avg_logprob=-0.21,
                    no_speech_prob=0.01,
                    compression_ratio=1.1,
                )
            ],
            provider=ProviderInfo(
                name=self.name, model="fake-1", latency_ms=self._latency_ms
            ),
        )
