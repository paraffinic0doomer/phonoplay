"""
Practice-material generation.

The tests that matter here are the negative ones. Generation is allowed to
fail, be slow, or return nonsense — the bank covers all of that. What is not
allowed is for a language model to influence a score, and that is asserted
from several directions rather than trusted to the prompt wording.
"""

from __future__ import annotations

import json

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.journey import material
from app.journey.material import StageMaterial, starts_with_target
from app.journey.stages import STAGES


def _settings(**kwargs) -> Settings:
    return Settings(groq_api_key="test-key", groq_api_keys="", groq_keys_file="", **kwargs)


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _completion(payload: dict) -> httpx.Response:
    return httpx.Response(
        200, json={"choices": [{"message": {"content": json.dumps(payload)}}]}
    )


VALID = {
    "text": "soap",
    "display": None,
    "contrast": "thope",
    "cue": "Keep the tongue tip behind your top teeth.",
}


# ── The score guard ──────────────────────────────────────────────────


def test_a_generated_score_field_is_rejected_outright():
    """
    `extra="forbid"` is what turns "the model added a score" from a silent
    no-op into a validation error. Without it the field would be dropped
    quietly, and a future refactor that started reading `model_extra` would
    reintroduce fabricated scoring with nothing to catch it.
    """
    with pytest.raises(ValidationError):
        StageMaterial.model_validate(VALID | {"score": 0.92})


@pytest.mark.parametrize(
    "field", ["score", "similarity", "rating", "confidence", "accuracy", "percent"]
)
def test_no_assessment_shaped_field_is_accepted(field):
    with pytest.raises(ValidationError):
        StageMaterial.model_validate(VALID | {field: 1})


def test_every_material_field_is_text():
    """There is no numeric field for a model to fill in even if it tried."""
    for name, info in StageMaterial.model_fields.items():
        assert info.annotation in (str, str | None), f"{name} is not text"


async def test_a_response_carrying_a_score_falls_back_to_the_bank():
    def handler(request: httpx.Request) -> httpx.Response:
        return _completion(VALID | {"score": 0.99, "mastery": 80})

    async with _client(handler) as client:
        result = await material.generate("s", 3, _settings(), client=client)

    assert result.source == "fallback"


# ── Verifying generated material ─────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "sound", "expected"),
    [
        ("soap", "s", True),
        ("banana", "s", False),
        ("shoe", "s", False),  # /ʃ/, not /s/
        ("think", "th", True),
        ("sink", "th", False),
        ("rag", "r", True),
        ("wrap", "r", True),  # silent w
        ("lace", "l", True),
        ("race", "l", False),
        ("", "s", False),
        ("Silver snake runs.", "s", True),
        ("The silver snake.", "s", False),  # first word is not the target
    ],
)
def test_material_is_verified_against_the_target_sound(text, sound, expected):
    assert starts_with_target(text, sound) is expected


async def test_material_without_the_target_sound_is_rejected():
    """
    Plausible material that does not contain the sound being practised is a
    worse failure than an obvious one: the acoustic stage would go looking
    for a /s/ that is not there and measure whatever it found.
    """
    def handler(request: httpx.Request) -> httpx.Response:
        return _completion(VALID | {"text": "banana"})

    async with _client(handler) as client:
        result = await material.generate("s", 3, _settings(), client=client)

    assert result.source == "fallback"
    assert starts_with_target(result.item.text, "s")


# ── Falling back ─────────────────────────────────────────────────────


async def test_generation_is_used_when_it_is_valid():
    def handler(request: httpx.Request) -> httpx.Response:
        return _completion(VALID)

    async with _client(handler) as client:
        result = await material.generate("s", 3, _settings(), client=client)

    assert result.source == "llm"
    assert result.item.text == "soap"


@pytest.mark.parametrize(
    "handler",
    [
        pytest.param(lambda r: httpx.Response(500), id="server-error"),
        pytest.param(lambda r: httpx.Response(429), id="rate-limited"),
        pytest.param(lambda r: httpx.Response(401), id="bad-key"),
        pytest.param(lambda r: httpx.Response(200, json={"nope": True}), id="wrong-shape"),
        pytest.param(
            lambda r: httpx.Response(
                200, json={"choices": [{"message": {"content": "not json"}}]}
            ),
            id="not-json",
        ),
    ],
)
async def test_any_provider_failure_falls_back(handler):
    async with _client(handler) as client:
        result = await material.generate("s", 3, _settings(), client=client)

    assert result.source == "fallback"
    assert result.item.text


async def test_a_timeout_falls_back_rather_than_raising():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow", request=request)

    async with _client(handler) as client:
        result = await material.generate("s", 3, _settings(), client=client)

    assert result.source == "fallback"


async def test_no_api_key_uses_the_bank_without_a_request():
    """The demo must not depend on a network call succeeding."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return _completion(VALID)

    settings = Settings(groq_api_key="", groq_api_keys="", groq_keys_file="/nonexistent")
    async with _client(handler) as client:
        result = await material.generate("s", 3, settings, client=client)

    assert result.source == "fallback"
    assert calls == []


async def test_the_isolated_stage_never_calls_the_model():
    """One correct answer, nothing to vary. An API call would be waste."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return _completion(VALID)

    async with _client(handler) as client:
        result = await material.generate("s", 1, _settings(), client=client)

    assert calls == []
    assert result.source == "fallback"


# ── The bank itself ──────────────────────────────────────────────────


@pytest.mark.parametrize("sound", ["s", "r", "l", "th"])
@pytest.mark.parametrize("stage", [s.index for s in STAGES])
def test_the_bank_covers_every_stage_of_every_sound(sound, stage):
    result = material.fallback(sound, stage)

    assert result.item.text
    assert result.item.cue
    assert result.stage == stage
    assert starts_with_target(result.item.text, sound)


def test_the_bank_can_avoid_what_was_just_practised():
    """Backs the "hold with varied material" decision."""
    just_done = material.fallback("s", 3).item.text
    for _ in range(20):
        assert material.fallback("s", 3, avoid=just_done).item.text != just_done


def test_later_stages_measure_only_the_first_occurrence():
    """A stated limitation, surfaced in the response rather than left implicit."""
    assert material.fallback("s", 3).first_occurrence_only is False
    assert material.fallback("s", 6).first_occurrence_only is True


# ── Voiced and voiceless TH are different sounds ──────────────────────


@pytest.mark.parametrize(
    "word", ["think", "thank", "three", "thin", "theme", "thick", "thumb", "therapy"]
)
def test_voiceless_th_words_are_accepted(word):
    assert starts_with_target(word, "th")


@pytest.mark.parametrize(
    "word",
    ["the", "this", "that", "these", "those", "they", "their", "there", "therefore",
     "then", "than", "though", "thus", "tho"],
)
def test_voiced_th_words_are_refused(word):
    """
    English spells the two TH sounds identically, and the reference corpus is
    entirely voiceless — theme, thick, thin, thing, think, thumb. Material
    beginning "the" or "this" would be measured against a profile for a
    different sound, marking down a learner who produced it perfectly.

    Observed in generated output: the phrase "the thick thrum" and the
    sentence "This thing is theirs", both voiced at the onset.
    """
    assert not starts_with_target(word, "th")


def test_the_exclusion_is_by_word_not_by_prefix():
    # "theme" and "therapy" are voiceless and would be caught by any prefix
    # rule broad enough to catch "the".
    assert starts_with_target("theme", "th")
    assert starts_with_target("therapy", "th")
    assert not starts_with_target("the", "th")


def test_every_th_bank_entry_is_voiceless():
    for stage in range(7):
        item = material.fallback("th", stage).item
        assert starts_with_target(item.text, "th"), f"stage {stage}: {item.text!r}"
