from fastapi.testclient import TestClient

from app.main import app
from app.routers.attempts import SESSION_ATTEMPTS


def test_catalog_serves_supported_sounds_and_prompts():
    with TestClient(app) as client:
        sounds = client.get("/api/sounds")
        prompt = client.get("/api/prompts", params={"sound": "s", "level": "word"})

    assert sounds.status_code == 200
    assert {item["id"] for item in sounds.json()} == {"s", "r", "l", "th"}
    assert prompt.status_code == 200
    assert prompt.json()["target_sound"] == "s"


def test_progress_returns_attempt_points_and_delta():
    SESSION_ATTEMPTS["test-session"] = [
        {"sound": "s", "score": 61, "ts": "2026-01-01T00:00:00Z"},
        {"sound": "s", "score": 78, "ts": "2026-01-02T00:00:00Z"},
    ]
    try:
        with TestClient(app) as client:
            body = client.get("/api/sessions/test-session/progress").json()
    finally:
        SESSION_ATTEMPTS.pop("test-session", None)

    assert body["by_sound"]["s"][1]["score"] == 78
    assert body["deltas"]["s"] == 17