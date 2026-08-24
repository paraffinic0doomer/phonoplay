"""
Failure taxonomy for the transcription stage.

Every provider failure is mapped onto one of these before it leaves
`app/stt/`, so routers never branch on provider-specific status codes and the
frontend gets one stable set of error codes (mirrored in
`web/src/types/api.ts`).
"""

from __future__ import annotations


class SttError(Exception):
    """Base class. `code` is what the frontend switches on."""

    code: str = "STT_FAILED"
    http_status: int = 502
    retryable: bool = False

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


class SttNotConfigured(SttError):
    """No API key. A deployment mistake, not a user problem."""

    code = "STT_NOT_CONFIGURED"
    http_status = 503
    retryable = False


class SttAuthError(SttError):
    """Key rejected. Retrying will not help."""

    code = "STT_AUTH_FAILED"
    http_status = 502
    retryable = False


class SttRateLimited(SttError):
    """Provider quota exhausted. `retry_after` comes from the response."""

    code = "STT_RATE_LIMITED"
    http_status = 429
    retryable = True


class SttTimeout(SttError):
    """Provider did not answer inside the budget."""

    code = "STT_TIMEOUT"
    http_status = 504
    retryable = True


class SttUnavailable(SttError):
    """Provider is down or unreachable."""

    code = "STT_UNAVAILABLE"
    http_status = 502
    retryable = True


class SttInvalidAudio(SttError):
    """The provider could not read the audio we sent."""

    code = "STT_INVALID_AUDIO"
    http_status = 422
    retryable = False


class SttBadResponse(SttError):
    """The provider answered with something we cannot parse."""

    code = "STT_BAD_RESPONSE"
    http_status = 502
    retryable = True


class AudioError(Exception):
    """Problems with the uploaded audio, detected before any provider call."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        http_status: int = 422,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.retryable = retryable
