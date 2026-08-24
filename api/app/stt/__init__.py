"""
Provider registry.

Application code asks for `get_provider()` and receives *some*
`SpeechToTextProvider`. Nothing outside this package names Groq.
"""

from __future__ import annotations

from ..config import Settings, get_settings
from .base import (
    AudioPayload,
    ProviderInfo,
    Segment,
    SpeechToTextProvider,
    Transcription,
    Word,
)
from .errors import (
    AudioError,
    SttAuthError,
    SttBadResponse,
    SttError,
    SttInvalidAudio,
    SttNotConfigured,
    SttRateLimited,
    SttTimeout,
    SttUnavailable,
)

__all__ = [
    "AudioError",
    "AudioPayload",
    "ProviderInfo",
    "Segment",
    "SpeechToTextProvider",
    "SttAuthError",
    "SttBadResponse",
    "SttError",
    "SttInvalidAudio",
    "SttNotConfigured",
    "SttRateLimited",
    "SttTimeout",
    "SttUnavailable",
    "Transcription",
    "Word",
    "build_provider",
    "get_provider",
    "set_provider",
]

_provider: SpeechToTextProvider | None = None


def build_provider(settings: Settings | None = None) -> SpeechToTextProvider:
    """Construct the provider named by STT_PROVIDER."""
    settings = settings or get_settings()
    name = settings.stt_provider.lower()

    if name == "groq":
        from .groq_provider import GroqSpeechToText

        return GroqSpeechToText(
            api_key=settings.groq_api_key,
            api_keys=settings.groq_api_key_pool,
            model=settings.groq_model,
            base_url=settings.groq_base_url,
            connect_timeout=settings.stt_connect_timeout,
            read_timeout=settings.stt_read_timeout,
            max_retries=settings.stt_max_retries,
            retry_backoff=settings.stt_retry_backoff,
            max_retry_delay=settings.stt_max_retry_delay,
        )

    if name == "fake":
        # Test/offline provider. Never selected unless STT_PROVIDER=fake.
        from .fake_provider import FakeSpeechToText

        return FakeSpeechToText()

    raise ValueError(f"Unknown STT_PROVIDER {settings.stt_provider!r}")


def get_provider() -> SpeechToTextProvider:
    """The process-wide provider. Built once, reused across requests."""
    global _provider
    if _provider is None:
        _provider = build_provider()
    return _provider


def set_provider(provider: SpeechToTextProvider | None) -> None:
    """Swap the provider. Used by app startup and by tests."""
    global _provider
    _provider = provider
