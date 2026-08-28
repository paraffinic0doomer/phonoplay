"""
Generated practice: what it may contain, and what it may never contain.

The generator is told what the acoustic stage measured and writes practice
around it. These tests are mostly about the second half of that sentence — the
guards that stop generated text becoming a measurement, a claim about a
person, or material that would break the measurement it is meant to support.
"""

from __future__ import annotations

import asyncio

import pytest

from app.config import Settings
from app.llm.exercise import (
    SUPPORTED,
    AccessibilityExercise,
    ExerciseEvidence,
    RejectedExercise,
    StandardExercise,
    _extract_json,
    bank,
    check_content,
    fallback,
    generate,
)

NO_KEYS = Settings(groq_api_keys="", groq_keys_file="missing-groq-keys.txt")


def evidence(**overrides) -> ExerciseEvidence:
    base = {
        "target_phoneme": "th",
        "mastery": 0.42,
        "confidence": 0.81,
        "recent_scores": [0.31, 0.38, 0.42],
        "current_stage": "word",
        "learning_mode": "standard",
        "exercise_type": "production",
        "contrast_accuracy": 0.6,
        "native_language": "bn",
        "target_language": "en",
    }
    base.update(overrides)
    return ExerciseEvidence.model_validate(base)


# ── What the generator is told ───────────────────────────────────────


def test_evidence_carries_everything_the_generator_needs():
    summary = evidence().summary()
    for key in (
        "target_sound",
        "mastery",
        "analyser_confidence",
        "recent_scores",
        "current_stage",
        "learning_mode",
        "exercise_type",
        "minimal_pair_accuracy",
        "first_language",
        "practising",
    ):
        assert key in summary, key


def test_evidence_rejects_anything_it_was_not_given():
    # extra="forbid" so a caller cannot smuggle a field into the prompt, and
    # so a renamed field fails loudly instead of silently going missing.
    with pytest.raises(Exception):
        ExerciseEvidence.model_validate({"target_phoneme": "s", "score": 91})


def test_evidence_tolerates_a_learner_with_no_history():
    summary = evidence(mastery=None, confidence=None, recent_scores=[], contrast_accuracy=None).summary()
    assert summary["mastery"] is None
    assert summary["recent_scores"] == []


def test_evidence_clamps_scores_into_range():
    assert ExerciseEvidence(target_phoneme="s", recent_scores=[-1.0, 2.0]).recent_scores == [0.0, 1.0]


# ── The bank ─────────────────────────────────────────────────────────


def test_the_bank_covers_every_sound_in_both_modes():
    for target in SUPPORTED:
        StandardExercise.model_validate(bank(target, "standard"))
        AccessibilityExercise.model_validate(bank(target, "accessibility"))


def test_every_bank_entry_passes_its_own_guards():
    # The fallback is what a learner sees whenever generation fails, so it has
    # to satisfy the rules generated content is held to.
    for target in SUPPORTED:
        for mode in ("standard", "accessibility"):
            check_content(bank(target, mode), target)


def test_fallback_is_a_complete_response():
    for target in SUPPORTED:
        result = fallback(target, "attempt-1")
        assert result["source"] == "fallback"
        assert len(result["items"]) == 3
        assert result["cue"]


def test_accessibility_asks_for_less_at_once():
    for target in SUPPORTED:
        standard = bank(target, "standard")
        accessible = bank(target, "accessibility")
        assert len(accessible["words"]) < len(standard["words"])
        assert len(accessible["explanation"]) <= len(standard["explanation"])
        # A phrase and a sentence on the same card is the opposite of a
        # smaller step. Those are later rungs.
        assert "phrase" not in accessible
        assert "sentence" not in accessible
        # And the things the mode exists to provide are present.
        assert accessible["isolation"]
        assert accessible["minimal_pair"]["contrast"]
        assert accessible["repeat_cue"]
        assert accessible["next_step"]


def test_repetition_is_words_not_a_number():
    # How many repetitions a learner needs is a policy decision the learner
    # model owns. A number here would be the generator setting the dose.
    for target in SUPPORTED:
        assert isinstance(bank(target, "accessibility")["repeat_cue"], str)


# ── Guards the schema cannot express ─────────────────────────────────


def test_a_score_shaped_string_is_rejected():
    payload = bank("s", "standard")
    payload["encouragement"] = "You scored 82% on that one."
    with pytest.raises(RejectedExercise):
        check_content(payload, "s")


def test_a_fraction_is_rejected_too():
    payload = bank("s", "standard")
    payload["challenge"] = "You got 3 out of 5 right."
    with pytest.raises(RejectedExercise):
        check_content(payload, "s")


@pytest.mark.parametrize(
    "text",
    [
        "This may indicate a speech disorder.",
        "A common sign of dyslexia.",
        "Consider speech therapy for this.",
        "This screening suggests a deficit.",
        "An impairment in the articulation.",
    ],
)
def test_clinical_language_is_rejected(text):
    payload = bank("th", "standard")
    payload["explanation"] = text
    with pytest.raises(RejectedExercise):
        check_content(payload, "th")


def test_a_word_that_does_not_start_with_the_sound_is_rejected():
    # The acoustic stage listens at the start of the utterance. Material whose
    # first word does not begin with the target would be scored against a
    # sound that is not there - the generator quietly breaking the measurement.
    payload = bank("s", "standard")
    payload["words"][0]["text"] = "apple"
    with pytest.raises(RejectedExercise):
        check_content(payload, "s")


def test_a_phrase_that_does_not_start_with_the_sound_is_rejected():
    payload = bank("r", "standard")
    payload["phrase"] = "The red rabbit"
    with pytest.raises(RejectedExercise):
        check_content(payload, "r")


def test_a_lookalike_spelling_is_rejected():
    # "shine" starts with an s on the page and a different sound in the mouth.
    payload = bank("s", "standard")
    payload["words"][0]["text"] = "shine"
    with pytest.raises(RejectedExercise):
        check_content(payload, "s")


def test_a_minimal_pair_must_actually_contrast():
    payload = bank("th", "accessibility")
    payload["minimal_pair"]["contrast"] = "thick"
    with pytest.raises(RejectedExercise):
        check_content(payload, "th")


def test_a_minimal_pair_target_must_carry_the_sound():
    payload = bank("th", "accessibility")
    payload["minimal_pair"]["target"] = "tin"
    with pytest.raises(RejectedExercise):
        check_content(payload, "th")


# ── Schema-level guards ──────────────────────────────────────────────


def test_an_unexpected_field_fails_validation():
    # extra="forbid": a returned `score` fails rather than riding along.
    payload = bank("s", "standard")
    payload["score"] = 0.9
    with pytest.raises(Exception):
        StandardExercise.model_validate(payload)


def test_there_is_no_numeric_field_to_fill():
    for model in (StandardExercise, AccessibilityExercise):
        for name, field in model.model_fields.items():
            annotation = str(field.annotation)
            assert "int" not in annotation and "float" not in annotation, f"{model.__name__}.{name}"


def test_malformed_json_is_rejected():
    with pytest.raises(ValueError):
        _extract_json("not json")


def test_a_json_array_is_rejected():
    with pytest.raises(ValueError):
        _extract_json("[1, 2, 3]")


def test_a_fenced_object_is_accepted():
    assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}


# ── Falling back ─────────────────────────────────────────────────────


def test_generation_falls_back_without_a_key():
    result = asyncio.run(generate(evidence(), NO_KEYS, "a"))
    assert result["source"] == "fallback"
    assert len(result["items"]) == 3


def test_the_fallback_matches_the_mode():
    result = asyncio.run(generate(evidence(learning_mode="accessibility"), NO_KEYS, "a"))
    assert result["source"] == "fallback"
    assert result["learning_mode"] == "accessibility"
    assert len(result["items"]) == 2
    AccessibilityExercise.model_validate(result["content"])


def test_generation_accepts_a_plain_dict():
    result = asyncio.run(generate({"target_phoneme": "l"}, NO_KEYS, "a"))
    assert result["target_sound"] == "l"


def test_an_unsupported_sound_is_refused_before_any_call():
    with pytest.raises(Exception):
        asyncio.run(generate({"target_phoneme": "zz"}, NO_KEYS, "a"))


def test_every_response_says_where_it_came_from():
    # A learner can always see whether the card was generated or banked.
    result = asyncio.run(generate(evidence(), NO_KEYS, "a"))
    assert result["source"] in {"llm", "fallback"}
