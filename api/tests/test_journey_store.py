"""
Journey persistence — including the property the feature exists for: a
learner can close the tab and come back to where they were.
"""

from __future__ import annotations

import pytest

from app.journey.stages import FIRST_STAGE
from app.journey.store import JourneyStore


@pytest.fixture
def store(tmp_path):
    db = JourneyStore(tmp_path / "journey.db")
    yield db
    db.close()


def test_a_new_learner_starts_at_the_first_stage(store):
    journey = store.get("learner-1", "s")

    assert journey.stage == FIRST_STAGE
    assert journey.started_at


def test_the_stage_survives_reopening_the_database(tmp_path):
    """The whole point of persisting: come back later, continue where you were."""
    path = tmp_path / "journey.db"

    first = JourneyStore(path)
    first.get("learner-1", "r")
    first.set_stage("learner-1", "r", 4)
    first.record(
        "learner-1", "r", 4, outcome="pass", similarity=0.8, confidence=0.9,
        estimated_match="r", feedback_code="ON_TARGET", prompt_text="rabbit",
        decision="hold",
    )
    first.close()

    reopened = JourneyStore(path)
    try:
        assert reopened.get("learner-1", "r").stage == 4
        assert reopened.counts("learner-1", "r") == {"pass": 1}
        assert reopened.history("learner-1", "r")[0].prompt_text == "rabbit"
    finally:
        reopened.close()


def test_journeys_are_independent_per_sound(store):
    store.set_stage("learner-1", "s", 5)

    assert store.get("learner-1", "s").stage == 5
    assert store.get("learner-1", "r").stage == FIRST_STAGE


def test_journeys_are_independent_per_learner(store):
    store.set_stage("learner-1", "s", 6)

    assert store.get("learner-2", "s").stage == FIRST_STAGE


def test_outcomes_are_scoped_to_a_stage(store):
    """
    A failure at stage 5 says nothing about stage 3. Carrying outcomes across
    stages would make retreating into a trap: the learner would arrive at the
    simpler stage already holding the failures that sent them there.
    """
    for stage, outcome in ((3, "pass"), (3, "pass"), (4, "fail")):
        store.record(
            "learner-1", "s", stage, outcome=outcome, similarity=0.5, confidence=0.5,
            estimated_match="s", feedback_code="X", prompt_text=None, decision=None,
        )

    assert store.outcomes_at_stage("learner-1", "s", 3) == ["pass", "pass"]
    assert store.outcomes_at_stage("learner-1", "s", 4) == ["fail"]
    assert store.outcomes_at_stage("learner-1", "s", 5) == []


def test_outcomes_are_returned_oldest_first(store):
    for outcome in ("fail", "pass", "unclear"):
        store.record(
            "learner-1", "s", 1, outcome=outcome, similarity=0.5, confidence=0.5,
            estimated_match=None, feedback_code="X", prompt_text=None, decision=None,
        )

    # The policy reads this as a chronological sequence; reversed order would
    # silently invert every streak rule.
    assert store.outcomes_at_stage("learner-1", "s", 1) == ["fail", "pass", "unclear"]


def test_all_for_lists_only_started_journeys(store):
    store.get("learner-1", "s")
    store.get("learner-1", "th")

    assert {j.sound for j in store.all_for("learner-1")} == {"s", "th"}


def test_history_is_capped(store):
    for index in range(30):
        store.record(
            "learner-1", "s", 1, outcome="pass", similarity=0.5, confidence=0.5,
            estimated_match="s", feedback_code="X", prompt_text=str(index), decision=None,
        )

    assert len(store.history("learner-1", "s", limit=5)) == 5


def test_no_audio_is_ever_stored(store, tmp_path):
    """
    The schema is the guarantee. There is no column audio could be written
    to, so no future change can start persisting recordings by accident.
    """
    columns = {
        row[1]
        for row in store._db.execute("PRAGMA table_info(attempts)").fetchall()
    }

    assert not {c for c in columns if "audio" in c or "blob" in c or "wav" in c}
    assert columns == {
        "id", "learner_id", "sound", "stage", "outcome", "similarity",
        "confidence", "estimated_match", "feedback_code", "prompt_text",
        "decision", "created_at",
    }
