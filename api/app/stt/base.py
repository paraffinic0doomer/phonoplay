"""
Speech-to-text provider abstraction.

PhonoPlay runs two independent analyses over the same recording:

  STAGE 1  transcription        — this module. What words were said.
  STAGE 2  acoustic analysis    — app/acoustic/*. How they were produced.

They are separate on purpose and must stay that way.

A transcript is NOT a pronunciation assessment. Whisper is a sequence model
with a strong language prior: it actively repairs mispronunciations toward
plausible English. Say "wabbit" and it may well write "rabbit". That makes it
a good signal for *which word* was attempted and a poor one for *how the
sounds were made*. Nothing downstream may treat any field in `Transcription`
as evidence about phoneme quality — that evidence comes from the frame-level
posteriors in stage 2 (ARCHITECTURE.md §3.3–3.5).

Every provider returns the same normalized `Transcription`, so swapping Groq
for another backend touches only this package.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field, model_validator

from .languages import to_iso_639_1


class AudioPayload(BaseModel):
    """Audio handed to a provider, already normalized by app/audio/ingest.py."""

    data: bytes
    filename: str
    mime_type: str

    @property
    def size_bytes(self) -> int:
        return len(self.data)


class Word(BaseModel):
    """One word with timings, when the provider supports word granularity."""

    word: str
    start: float | None = None
    end: float | None = None


class Segment(BaseModel):
    """A contiguous chunk of speech."""

    id: int
    start: float
    end: float
    text: str
    words: list[Word] = Field(default_factory=list)
    # Whisper's own diagnostics. Useful for spotting a bad capture; NOT a
    # pronunciation score.
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    compression_ratio: float | None = None


class ProviderInfo(BaseModel):
    name: str
    model: str
    latency_ms: int


class Transcription(BaseModel):
    """
    The normalized result every provider returns.

    `pronunciation_assessed` is always False and is part of the wire format on
    purpose: any consumer reading this object is told, in the payload itself,
    that nothing here measures pronunciation quality.
    """

    transcript: str
    #: As the provider reported it. Groq returns a full name ("English"),
    #: not a code, so this field is free-form on purpose.
    language: str | None = None
    #: ISO-639-1 form of `language` when it maps to one, else None.
    language_code: str | None = None
    duration: float | None = None
    segments: list[Segment] = Field(default_factory=list)
    provider: ProviderInfo
    stage: str = "transcription"
    pronunciation_assessed: bool = False

    @model_validator(mode="after")
    def _derive_language_code(self) -> "Transcription":
        # Providers only have to report `language`; the code is derived once,
        # here, so every backend behaves the same way.
        if self.language_code is None:
            object.__setattr__(self, "language_code", to_iso_639_1(self.language))
        return self

    @property
    def words(self) -> list[Word]:
        """Flattened word timings across all segments."""
        return [word for segment in self.segments for word in segment.words]


class SpeechToTextProvider(ABC):
    """
    Implement this to add a backend. Nothing outside `app/stt/` may construct
    a concrete provider directly — use `app.stt.get_provider()`.
    """

    #: Stable identifier reported in `ProviderInfo.name`.
    name: str

    @abstractmethod
    async def transcribe(
        self,
        audio: AudioPayload,
        *,
        language: str | None = None,
        prompt: str | None = None,
    ) -> Transcription:
        """
        Transcribe `audio`.

        Args:
            language: ISO-639-1 hint. Improves accuracy when known.
            prompt: Short context hint (e.g. the target word). Providers cap
                this; keep it to a few tokens.

        Raises:
            SttError: every failure path, already classified.
        """

    async def aclose(self) -> None:
        """Release any long-lived resources. Called on app shutdown."""
