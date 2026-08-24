"""
Language safety.

PhonoPlay is a pronunciation practice tool. It reports what a recording
measured and what to try next. It does not name conditions, does not
diagnose, and must not imply that a pronunciation pattern is a disorder —
that is a judgement only a qualified professional can make, from far more
evidence than one two-second recording.

These tests read the actual strings the product can emit rather than trusting
a review to have caught everything, so a clinical term added later fails the
build instead of reaching a child.
"""

from __future__ import annotations

import re

import pytest

from app.acoustic import feedback
from app.acoustic.phonemes import INVENTORY, TARGETS
from app.journey import material, policy, stages

#: Words that would turn feedback into a claim about a person rather than a
#: description of a sound. "Disorder", "diagnosis" and the condition names are
#: the ones that matter most; the rest are the vocabulary that tends to arrive
#: alongside them.
FORBIDDEN = [
    "lisp", "lisping", "rhotacism", "sigmatism", "disorder", "diagnos",
    "pathology", "pathological", "impairment", "impaired", "deficit",
    "abnormal", "dysfunction", "therapy", "therapist", "patient",
    "treatment", "symptom", "condition", "delay", "clinical",
]


def offending(text: str) -> list[str]:
    lowered = text.lower()
    return [word for word in FORBIDDEN if re.search(rf"\b{word}", lowered)]


def learner_facing_strings() -> list[tuple[str, str]]:
    """Every string the product can put in front of a learner."""
    out: list[tuple[str, str]] = []

    out.append(("UNCERTAIN_MESSAGE", feedback.UNCERTAIN_MESSAGE))
    for (target, observed), cue in feedback._SUBSTITUTION_CUES.items():
        out.append((f"substitution cue {target}->{observed}", cue))
    for target, hint in feedback._RETRY_HINTS.items():
        out.append((f"retry hint {target}", hint))
    for target, cue in feedback._IMPRECISE_CUES.items():
        out.append((f"imprecise cue {target}", cue))

    for code in (
        feedback.NO_SPEECH_DETECTED, feedback.AUDIO_TOO_NOISY,
        feedback.AUDIO_CLIPPED, feedback.AUDIO_TOO_SHORT,
        feedback.TARGET_NOT_LOCATED,
    ):
        result = feedback.for_blocked(code)
        out.append((f"{code} message", result.message))
        if result.cue:
            out.append((f"{code} cue", result.cue))

    for target in TARGETS:
        for observed in INVENTORY:
            for similarity in (0.9, 0.45, 0.1):
                result = feedback.for_verdict(target, observed, similarity)
                out.append((f"verdict {target}/{observed}", result.message))
                if result.cue:
                    out.append((f"verdict cue {target}/{observed}", result.cue))
        uncertain = feedback.for_uncertain(target, "reason")
        out.append((f"uncertain {target}", uncertain.message))

    for phoneme in INVENTORY.values():
        out.append((f"label {phoneme.key}", phoneme.label))

    for stage in stages.STAGES:
        out.append((f"stage {stage.key} title", stage.title))
        out.append((f"stage {stage.key} instruction", stage.instruction))

    for outcomes in ([], ["pass"], ["pass", "pass"], ["fail", "fail"], ["pass", "fail"], ["unclear"]):
        for stage_index in (1, 4, 7):
            out.append((
                f"decision {stage_index} {outcomes}",
                policy.decide(stage_index, list(outcomes)).reason,
            ))

    for sound in TARGETS:
        for stage in stages.STAGES:
            item = material.fallback(sound, stage.index).item
            out.append((f"material {sound}/{stage.key} text", item.text))
            out.append((f"material {sound}/{stage.key} cue", item.cue))

    return out


@pytest.mark.parametrize(("where", "text"), learner_facing_strings())
def test_no_learner_facing_string_uses_clinical_language(where, text):
    found = offending(text)
    assert not found, f"{where} contains {found}: {text!r}"


def test_the_generator_is_told_not_to_diagnose():
    """
    The system prompt is the only instruction the model gets, so its content
    is part of the safety surface.
    """
    system = material._SYSTEM.lower()

    assert "never" in system
    assert "diagnos" in system, "the prompt must explicitly forbid diagnosis"
    assert "score" in system or "assess" in system


def test_the_refusal_message_is_exactly_what_was_promised():
    """
    The product promises this sentence when it cannot tell. Not a softened
    version, and not a partial verdict dressed up as one.
    """
    assert feedback.UNCERTAIN_MESSAGE == "Unable to confidently assess this attempt."

    for target in TARGETS:
        assert feedback.for_uncertain(target, None).message == feedback.UNCERTAIN_MESSAGE


def test_a_substitution_is_described_as_a_sound_not_a_speaker():
    """
    Feedback describes what the recording measured like. It never attributes
    a property to the person who made it.
    """
    result = feedback.for_verdict("s", "th", 0.1)

    assert "measured closer to" in result.message
    assert not re.search(r"\byou (have|are)\b", result.message.lower())
