from pathlib import Path

from app.config import Settings


def test_groq_key_pool_reads_file_without_duplicates(tmp_path: Path):
    key_file = tmp_path / "groq.txt"
    key_file.write_text("key-a\n\nkey-b\nkey-a\n", encoding="utf-8")

    settings = Settings(stt_provider="groq", groq_keys_file=str(key_file))

    assert settings.groq_api_key_pool == ["key-a", "key-b"]

def test_the_key_pool_survives_a_shallow_install_path(monkeypatch):
    """
    Regression: the pool located the repository root with
    `Path(__file__).resolve().parents[3]`, indexed unconditionally.

    That holds on a dev checkout, where config.py sits five levels deep, and
    raises IndexError inside a container, where it is /app/app/config.py with
    three. Because the pool is read from the FastAPI lifespan, the IndexError
    surfaced as `Exited with status 3` on deploy — uvicorn's startup-failure
    code — with nothing pointing at a key file as the cause.
    """
    from app import config as config_module

    monkeypatch.setattr(config_module, "__file__", "/app/app/config.py")
    settings = Settings(groq_api_key="from-env", groq_api_keys="", groq_keys_file="")

    assert "from-env" in settings.groq_api_key_pool


def test_the_key_pool_never_raises(monkeypatch, tmp_path):
    """
    It runs during startup, so any exception takes the whole service down.
    An unreadable or missing path must be skipped, not propagated.
    """
    settings = Settings(
        groq_api_key="", groq_api_keys="", groq_keys_file=str(tmp_path / "nope.txt")
    )

    assert settings.groq_api_key_pool == []


def test_the_service_starts_with_only_environment_configuration(monkeypatch, tmp_path):
    """
    A deployment passes keys through the environment and has no key file
    anywhere. Boot the real app the way a container does and assert the
    lifespan completes — this is the check that would have caught the
    failed deploy before it happened.
    """
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.journey.store import set_store
    from app.main import app

    monkeypatch.chdir(tmp_path)  # no groq.txt in the working directory
    app.dependency_overrides[get_settings] = lambda: Settings(
        groq_api_key="env-key",
        groq_api_keys="",
        groq_keys_file="",
        journey_db_path=str(tmp_path / "journey.db"),
    )
    try:
        with TestClient(app) as client:
            assert client.get("/api/health").status_code == 200
    finally:
        app.dependency_overrides.clear()
        set_store(None)
