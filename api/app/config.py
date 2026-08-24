"""Runtime configuration. Everything comes from the environment or .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: str = "http://localhost:5173,http://localhost:4173"

    # ── Speech-to-text ───────────────────────────────────────────────
    stt_provider: str = "groq"
    #: Never sent to the browser. Server-side only.
    groq_api_key: str = ""
    groq_api_keys: str = ""
    groq_keys_file: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    #: whisper-large-v3-turbo is ~3x cheaper and faster than large-v3 at a
    #: small accuracy cost. Word-level accuracy matters more to us than the
    #: last point of WER, so this is the default; override to compare.
    groq_model: str = "whisper-large-v3-turbo"
    #: ISO-639-1 hint. PhonoPlay prompts are English, and telling Whisper so
    #: measurably reduces spurious language switching on short clips.
    stt_language: str = "en"

    #: Connect / read budget for one provider call, in seconds.
    stt_connect_timeout: float = 5.0
    stt_read_timeout: float = 30.0
    #: One retry only, and only for transient failures. Short clips are cheap
    #: to re-send but the provider bills a 10-second minimum per request, so
    #: retrying aggressively wastes real money.
    stt_max_retries: int = 1
    stt_retry_backoff: float = 0.75
    #: Never sleep longer than this even if the provider asks us to.
    stt_max_retry_delay: float = 5.0

    # ── Audio limits ─────────────────────────────────────────────────
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    #: Reject before transcoding. The client caps clips at 8 s.
    max_upload_bytes: int = 15 * 1024 * 1024
    min_duration_s: float = 0.2
    max_duration_s: float = 30.0
    #: Groq recommends 16 kHz mono; transcoding also normalizes the container
    #: so browser format differences never reach the provider.
    target_sample_rate: int = 16000
    target_channels: int = 1

    #: Chat model for generating practice material. A *different* model from
    #: `groq_model`, which is a speech-to-text model and cannot answer a chat
    #: completion at all. Keeping them as separate settings is what stops the
    #: two Groq surfaces from being confused for one another.
    #:
    #: Verified against this account's GET /models. `llama-3.3-70b-versatile`
    #: was the first choice and returns 404 model_not_found here; of what is
    #: actually available, the 20b and qwen variants both failed Groq's JSON
    #: validation on this schema while the 120b returned valid JSON in ~770ms.
    #: Check GET /openai/v1/models before changing this.
    groq_chat_model: str = "openai/gpt-oss-120b"
    #: Budget for one material-generation call. Short: the fallback bank is
    #: always available, so waiting is never worth it.
    llm_timeout_s: float = 10.0

    # ── Journey persistence ──────────────────────────────────────────
    #: SQLite file holding learner progress. Under storage/, which is
    #: gitignored. No audio is ever written here — see app/journey/store.py.
    journey_db_path: str = "storage/journey.db"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def groq_api_key_pool(self) -> list[str]:
        """
        Read configured keys without exposing them to application output.

        Runs during startup, so it must never raise. An earlier version
        indexed `Path(__file__).resolve().parents[3]` unconditionally to find
        the repository root. That holds on a dev checkout
        (api/app/config.py -> 5 ansectors) and raises IndexError in a
        container, where the file lives at /app/app/config.py with only three.
        The result was a crash in the FastAPI lifespan and `Exited with
        status 3` on deploy — uvicorn's startup-failure code — for what is
        only a local-development convenience.
        """
        keys = [key.strip() for key in self.groq_api_keys.split(",") if key.strip()]
        if self.groq_api_key.strip() and not self.groq_keys_file:
            keys.append(self.groq_api_key.strip())

        if self.groq_keys_file:
            paths = [Path(self.groq_keys_file)]
        else:
            # A key file next to the working directory, and one at the
            # repository root when there *is* one above us. Deployments pass
            # the key through the environment and match neither, which is the
            # intended behaviour rather than a fallback.
            here = Path(__file__).resolve()
            paths = [Path.cwd() / "groq.txt"]
            if len(here.parents) > 3:
                paths.append(here.parents[3] / "groq.txt")

        for path in paths:
            try:
                if path.is_file():
                    keys.extend(line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
                    break
            except OSError:
                continue
        return list(dict.fromkeys(keys))


@lru_cache
def get_settings() -> Settings:
    return Settings()
