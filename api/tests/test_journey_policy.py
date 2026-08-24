"""
The advancement policy.

`decide()` is a pure function, so the whole progression can be driven exactly:
every rule, every boundary, and the full seven-stage climb and descent.
"""

from __future__ import annotations

import pytest

from app.acoustic.scoring import CLOSE_SIMILARITY, ON_TARGET_SIMILARITY
from app.journey import policy
from app.journey.stages import FIRST_STAGE, LAST_STAGE

P, C, F, U = policy.PASS, policy.CLOSE, policy.FAIL, policy.UNCLEAR


# ── Classifying one attempt ──────────────────────────────────────────


def test_a_clear_target_production_is_a_pass():
    assert (
        policy.outcome_of(
            assessed=True, estimated_match="s", target="s", similarity=0.9
        )
        == P
    )


def test_a_different_sound_is_a_failure_however_similar():
    assert (
        policy.outcome_of(
            assessed=True, estimated_match="th", target="s", similarity=0.95
        )
        == F
    )


def test_an_imprecise_target_is_neither_pass_nor_fail():
    """
    The right sound produced imprecisely is progress. Counting it as a pass
    would advance someone on a blurred production; counting it as a failure
    would push them back for improving.
    """
    between = (ON_TARGET_SIMILARITY + CLOSE_SIMILARITY) / 2
    assert (
        policy.outcome_of(
            assessed=True, estimated_match="s", target="s", similarity=between
        )
        == C
    )


def test_an_unassessed_attempt_is_unclear():
    assert (
        policy.outcome_of(
            assessed=False, estimated_match=None, target="s", similarity=0.0
        )
        == U
    )


# ── The four rules ───────────────────────────────────────────────────


def test_two_passes_advance():
    decision = policy.decide(3, [P, P])

    assert decision.action == policy.ADVANCE
    assert decision.to_stage == 4
    assert decision.vary_material is True


def test_two_failures_retreat():
    decision = policy.decide(4, [F, F])

    assert decision.action == policy.RETREAT
    assert decision.to_stage == 3


def test_mixed_results_hold_with_different_material():
    decision = policy.decide(3, [P, F])

    assert decision.action == policy.HOLD
    assert decision.to_stage == 3
    assert decision.vary_material is True


def test_low_confidence_offers_a_hint_and_repeats():
    decision = policy.decide(3, [P, U])

    assert decision.action == policy.HINT
    assert decision.to_stage == 3
    assert decision.show_hint is True


def test_a_single_pass_is_not_enough_to_advance():
    assert policy.decide(3, [P]).action == policy.HOLD


# ── Unclear attempts do not break a streak ───────────────────────────


def test_an_unclear_attempt_between_two_passes_still_advances():
    """
    A learner who succeeds, is interrupted by a door slamming, then succeeds
    again has succeeded twice. The unclear attempt is dropped from the streak
    rather than treated as a neutral entry that resets it.
    """
    decision = policy.decide(3, [P, U, P])

    assert decision.action == policy.ADVANCE


def test_an_unclear_attempt_last_takes_priority_over_a_streak():
    """Rule 1 is evaluated first: there is nothing to advance on yet."""
    decision = policy.decide(3, [P, P, U])

    assert decision.action == policy.HINT
    assert decision.to_stage == 3


def test_only_unclear_attempts_hold():
    decision = policy.decide(3, [U, U])

    assert decision.action == policy.HINT


# ── Boundaries ───────────────────────────────────────────────────────


def test_the_first_stage_cannot_retreat():
    decision = policy.decide(FIRST_STAGE, [F, F])

    assert decision.action == policy.HOLD
    assert decision.to_stage == FIRST_STAGE


def test_the_last_stage_cannot_advance():
    decision = policy.decide(LAST_STAGE, [P, P])

    assert decision.action == policy.HOLD
    assert decision.to_stage == LAST_STAGE
    assert decision.vary_material is True


def test_no_history_holds():
    assert policy.decide(1, []).action == policy.HOLD


# ── The whole progression ────────────────────────────────────────────


def test_a_learner_can_climb_from_the_first_stage_to_the_last():
    """Two clear attempts per stage should reach the end, and stop there."""
    stage = FIRST_STAGE
    for _ in range(LAST_STAGE - FIRST_STAGE):
        decision = policy.decide(stage, [P, P])
        assert decision.action == policy.ADVANCE
        stage = decision.to_stage

    assert stage == LAST_STAGE
    assert policy.decide(stage, [P, P]).action == policy.HOLD


def test_a_learner_can_descend_from_the_last_stage_to_the_first():
    stage = LAST_STAGE
    for _ in range(LAST_STAGE - FIRST_STAGE):
        decision = policy.decide(stage, [F, F])
        assert decision.action == policy.RETREAT
        stage = decision.to_stage

    assert stage == FIRST_STAGE
    assert policy.decide(stage, [F, F]).action == policy.HOLD


@pytest.mark.parametrize("stage", range(FIRST_STAGE, LAST_STAGE + 1))
def test_a_decision_never_leaves_the_stage_range(stage):
    for outcomes in ([P, P], [F, F], [P, F], [U], [C, C], []):
        decision = policy.decide(stage, list(outcomes))
        assert FIRST_STAGE <= decision.to_stage <= LAST_STAGE
        assert abs(decision.to_stage - decision.from_stage) <= 1


def test_every_decision_carries_a_reason():
    for outcomes in ([P, P], [F, F], [P, F], [U], [], [C]):
        assert policy.decide(3, list(outcomes)).reason.strip()
