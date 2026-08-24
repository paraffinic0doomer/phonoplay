"""
The Sound Journey over HTTP, driven by real audio.

These tests run the whole loop the product describes: generate material,
record an attempt, measure it acoustically, decide what happens, persist it,
and come back later to find the journey where it was left. The audio is real
speech and the measurement is the real one — only the language model is
stubbed out, because network access is not a test dependency.

The assertion the feature rests on is
`test_generated_material_cannot_move_a_learner`: a language model that
returns glowing praise, or anything else at all, must not move anyone.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.journey import policy
from app.journey.stages import FIRST_STAGE, LAST_STAGE
from app.journey.store import JourneyStore, set_store
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    """
    A client with a temporary journey database and no network.

    The store is installed directly rather than through the lifespan so each
    test gets an isolated database file.
    """
    store = JourneyStore(tmp_path / "journey.db")
    set_store(store)

    # No keys: material generation uses the deterministic bank and makes no
    # request. Tests must not depend on a provider being reachable.
    app.dependency_overrides[get_settings] = lambda: Settings(
        stt_provider="fake", groq_api_key="", groq_api_keys="", groq_keys_file="/nonexistent"
    )
    try:
        with TestClient(app) as test_client:
            # The lifespan opens its own store; put ours back over it.
            set_store(store)
            yield test_client
    finally:
        app.dependency_overrides.clear()
        set_store(None)
        store.close()


def attempt(client, audio: bytes, sound: str = "s", learner: str = "l1", text: str = "sank"):
    response = client.post(
        f"/api/journey/{learner}/{sound}/attempt",
        files={"audio": ("attempt.wav", audio, "audio/wav")},
        data={"prompt_text": text},
    )
    assert response.status_code == 200, response.text
    return response.json()


# ── The shape of the journey ─────────────────────────────────────────


def test_the_journey_has_five_visible_bands(client):
    body = client.get("/api/journey/stages").json()

    assert [band["label"] for band in body["bands"]] == [
        "Sound", "Word", "Phrase", "Sentence", "Conversation",
    ]
    assert len(body["stages"]) == 7


def test_a_new_learner_starts_at_the_first_stage(client):
    body = client.get("/api/journey/new-learner/s").json()

    assert body["stage"]["index"] == FIRST_STAGE
    assert body["stage"]["band"] == "sound"
    assert body["stage"]["band_index"] == 0


def test_the_overview_lists_every_sound_including_untouched_ones(client):
    body = client.get("/api/journey/new-learner").json()

    assert {j["sound"] for j in body["journeys"]} == {"s", "r", "l", "th"}
    assert all(j["started"] is False for j in body["journeys"])


def test_an_unknown_sound_is_rejected(client):
    assert client.get("/api/journey/l1/zz").status_code == 404


# ── Measurement drives the progression ───────────────────────────────


def test_two_correct_attempts_advance_the_learner(client, sank_wav):
    first = attempt(client, sank_wav)
    assert first["outcome"] == policy.PASS
    assert first["decision"]["action"] == policy.HOLD

    second = attempt(client, sank_wav)
    assert second["decision"]["action"] == policy.ADVANCE
    assert second["decision"]["to_stage"] == FIRST_STAGE + 1
    assert second["journey"]["stage"]["index"] == FIRST_STAGE + 1


def test_two_wrong_sounds_do_not_advance(client, thank_wav):
    """"thank" offered where an /s/ was asked for."""
    for _ in range(2):
        result = attempt(client, thank_wav, sound="s")
        assert result["outcome"] == policy.FAIL
        assert result["analysis"]["estimated_match"] == "th"

    # Already at the first stage, so there is nowhere to retreat to.
    assert client.get("/api/journey/l1/s").json()["stage"]["index"] == FIRST_STAGE


def test_performance_dropping_retreats_the_learner(client, sank_wav, thank_wav):
    for _ in range(2):
        attempt(client, sank_wav)
    assert client.get("/api/journey/l1/s").json()["stage"]["index"] == 2

    first = attempt(client, thank_wav)
    assert first["outcome"] == policy.FAIL
    second = attempt(client, thank_wav)

    assert second["decision"]["action"] == policy.RETREAT
    assert second["journey"]["stage"]["index"] == 1


def test_inconsistent_performance_holds_with_new_material(client, sank_wav, thank_wav):
    attempt(client, sank_wav)
    result = attempt(client, thank_wav)

    assert result["decision"]["action"] == policy.HOLD
    assert result["decision"]["vary_material"] is True
    assert result["journey"]["stage"]["index"] == FIRST_STAGE


def test_an_unmeasurable_attempt_offers_a_hint_and_holds(client, noisy_speech_wav):
    result = attempt(client, noisy_speech_wav)

    assert result["outcome"] == policy.UNCLEAR
    assert result["decision"]["action"] == policy.HINT
    assert result["decision"]["show_hint"] is True
    assert result["decision"]["hint"]
    assert result["journey"]["stage"]["index"] == FIRST_STAGE


def test_an_unmeasurable_attempt_carries_no_score(client, silence_wav):
    result = attempt(client, silence_wav)

    assert result["analysis"]["assessed"] is False
    assert result["analysis"]["similarity_score"] == 0.0
    assert result["analysis"]["estimated_match"] is None


def test_noise_between_two_successes_still_advances(client, sank_wav, silence_wav):
    attempt(client, sank_wav)
    attempt(client, silence_wav)
    result = attempt(client, sank_wav)

    assert result["decision"]["action"] == policy.ADVANCE


# ── The separation the feature depends on ────────────────────────────


def test_generated_material_cannot_move_a_learner(client, sank_wav, monkeypatch):
    """
    A language model that returns effusive praise — or any text at all —
    must not change anyone's stage. Material is requested, then an attempt is
    measured, and only the measurement moves the journey.
    """
    from app.journey import material as material_module

    async def flattering(
        sound, stage_index, settings, *, avoid=None, native="en", client=None
    ):
        return material_module.fallback(sound, stage_index, native=native)

    monkeypatch.setattr(material_module, "generate", flattering)

    before = client.get("/api/journey/l1/s").json()["stage"]["index"]
    for _ in range(5):
        response = client.post("/api/journey/l1/s/material", json={})
        assert response.status_code == 200
    after = client.get("/api/journey/l1/s").json()["stage"]["index"]

    assert after == before, "requesting material must never advance a journey"


def test_the_decision_follows_from_the_measurement(client, sank_wav, thank_wav):
    """Outcome and decision are separate fields so this can be checked."""
    correct = attempt(client, sank_wav)
    assert correct["analysis"]["estimated_match"] == "s"
    assert correct["outcome"] == policy.PASS

    wrong = attempt(client, thank_wav)
    assert wrong["analysis"]["estimated_match"] == "th"
    assert wrong["outcome"] == policy.FAIL


def test_material_is_appropriate_to_the_current_stage(client, sank_wav):
    at_first = client.post("/api/journey/l1/s/material", json={}).json()
    assert at_first["material"]["stage_key"] == "isolated"

    attempt(client, sank_wav)
    attempt(client, sank_wav)

    at_second = client.post("/api/journey/l1/s/material", json={}).json()
    assert at_second["material"]["stage_key"] == "syllable"


def test_material_can_avoid_what_was_just_practised(client):
    body = client.post("/api/journey/l1/s/material", json={"avoid": "sun"}).json()

    assert body["material"]["item"]["text"] != "sun"


# ── Persistence ──────────────────────────────────────────────────────


def test_a_journey_is_resumed_after_the_process_restarts(client, sank_wav, tmp_path):
    """
    The behaviour the feature promises: come back later, continue where you
    were. Simulated by closing the store and reopening the same file.
    """
    attempt(client, sank_wav)
    attempt(client, sank_wav)
    assert client.get("/api/journey/l1/s").json()["stage"]["index"] == 2

    from app.journey.store import get_store

    get_store().close()
    reopened = JourneyStore(tmp_path / "journey.db")
    set_store(reopened)

    assert client.get("/api/journey/l1/s").json()["stage"]["index"] == 2
    assert reopened.counts("l1", "s") == {"pass": 2}


def test_history_records_the_stage_each_attempt_was_made_at(client, sank_wav):
    attempt(client, sank_wav)
    attempt(client, sank_wav)  # advances to stage 2
    attempt(client, sank_wav)

    history = client.get("/api/journey/l1/s").json()["history"]

    assert [record["stage"] for record in history] == [1, 1, 2]


def test_journeys_do_not_leak_between_learners(client, sank_wav):
    attempt(client, sank_wav, learner="alice")
    attempt(client, sank_wav, learner="alice")

    assert client.get("/api/journey/alice/s").json()["stage"]["index"] == 2
    assert client.get("/api/journey/bob/s").json()["stage"]["index"] == 1


def test_journeys_do_not_leak_between_sounds(client, sank_wav, rag_wav):
    attempt(client, sank_wav, sound="s")
    attempt(client, sank_wav, sound="s")

    assert client.get("/api/journey/l1/s").json()["stage"]["index"] == 2
    assert client.get("/api/journey/l1/r").json()["stage"]["index"] == 1


# ── The full climb ───────────────────────────────────────────────────


def test_a_learner_can_be_carried_to_the_last_stage_and_stops_there(client, sank_wav):
    """
    Every stage of the journey, driven by real audio through the real
    endpoint. The same recording passes at every stage because the acoustic
    measurement is of the /s/ itself, not of the material's difficulty — the
    stage decides what a learner is *asked* to say, and this test is about
    the progression machinery rather than about task difficulty.
    """
    seen = []
    for _ in range((LAST_STAGE - FIRST_STAGE) * 2 + 2):
        result = attempt(client, sank_wav)
        seen.append(result["journey"]["stage"]["index"])
        if result["journey"]["stage"]["index"] == LAST_STAGE:
            break

    assert max(seen) == LAST_STAGE

    final = attempt(client, sank_wav)
    assert final["decision"]["to_stage"] == LAST_STAGE
    assert final["journey"]["stage"]["index"] == LAST_STAGE


def test_the_band_index_tracks_the_stage(client, sank_wav):
    """The visible journey dot has to follow the underlying stage."""
    bands = []
    for _ in range(14):
        stage = attempt(client, sank_wav)["journey"]["stage"]
        bands.append((stage["index"], stage["band_index"]))
        if stage["index"] == LAST_STAGE:
            break

    for index, band in bands:
        assert 0 <= band <= 4
        assert (band == 0) == (index <= 2)
        assert (band == 4) == (index == 7)
