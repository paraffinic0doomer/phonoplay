"""
Multilingual support.

Two things are being tested here, and the second matters more than the first.

The first is that the feature works: a learner can say their first language is
Bangla, that choice persists, and the practice they get is personalized for it.

The second is that it **cannot destabilize the pronunciation pipeline**. The
acoustic stage measures an English sound against English reference data, and
the learner's first language is not one of its inputs. That is asserted from
several directions below — by signature, by behaviour on identical audio, and
by the absence of any language argument reaching `analyze()` — because a
regression there would be silent: scores would simply start meaning something
slightly different for some learners and nothing would fail.
"""

from __future__ import annotations

import inspect
import re

import pytest
from fastapi.testclient import TestClient

from app import languages as L
from app.acoustic import analyze
from app.config import Settings, get_settings
from app.journey import material
from app.journey.material import starts_with_target
from app.journey.stages import STAGES
from app.journey.store import JourneyStore, set_store
from app.main import app


@pytest.fixture
def client(tmp_path):
    store = JourneyStore(tmp_path / "journey.db")
    set_store(store)
    app.dependency_overrides[get_settings] = lambda: Settings(
        stt_provider="fake", groq_api_key="", groq_api_keys="", groq_keys_file="/nonexistent"
    )
    try:
        with TestClient(app) as test_client:
            set_store(store)
            yield test_client
    finally:
        app.dependency_overrides.clear()
        set_store(None)
        store.close()


# ── The registry ─────────────────────────────────────────────────────


def test_the_mvp_languages_are_english_and_bangla():
    assert set(L.LANGUAGES) == {"en", "bn"}
    assert L.language("bn").native_name == "বাংলা"
    assert L.language("bn").script == "Bengali"


def test_bangla_can_be_a_first_language_but_not_a_target():
    """
    Not a ranking. PhonoPlay measures against English reference audio and has
    no Bangla acoustic data, so there is nothing to measure a Bangla target
    against — and inventing a reference would be the exact fabrication this
    project refuses.
    """
    assert L.language("bn").can_be_native is True
    assert L.language("bn").can_be_target is False
    assert [lang.code for lang in L.target_options()] == ["en"]
    assert {lang.code for lang in L.native_options()} == {"en", "bn"}


def test_the_limitation_is_stated_where_it_is_chosen():
    """A constraint the learner can see beats one buried in a doc."""
    note = L.language("bn").target_note
    assert note and "English only" in note


def test_english_only_is_the_default():
    assert L.DEFAULT_NATIVE == "en"
    assert L.normalise_native(None) == "en"
    assert L.normalise_native("") == "en"


def test_an_unknown_language_falls_back_rather_than_raising():
    """A stale client must lose personalization, not lose the app."""
    assert L.normalise_native("klingon") == "en"
    assert L.normalise_native("xx") == "en"


# ── The bridges ──────────────────────────────────────────────────────


def test_the_bangla_th_progression_is_the_specified_one():
    bridge = L.bridge_for("bn", "th")

    assert bridge.progression == ["থ", "θ", "think", "three", "through"]
    assert bridge.anchor == "থ"
    assert bridge.anchor_ipa == "t̪ʰ"


@pytest.mark.parametrize("sound", ["s", "r", "l", "th"])
def test_every_bangla_bridge_starts_from_a_bangla_grapheme(sound):
    bridge = L.bridge_for("bn", sound)

    assert bridge.anchor is not None
    assert bridge.steps[0].kind == "native"
    assert bridge.steps[1].kind == "target"


@pytest.mark.parametrize("native", ["bn", "en"])
@pytest.mark.parametrize("sound", ["s", "r", "l", "th"])
def test_every_bridge_word_is_practisable(native, sound):
    """
    The words in a progression have to be measurable, or the bridge leads
    somewhere the app cannot follow. The journey measures the onset of the
    utterance, so every word must actually begin with the target sound —
    checked with the same function the material generator is checked with.
    """
    words = [s.text for s in L.bridge_for(native, sound).steps if s.kind == "word"]

    assert words, "a progression with no words is not a progression"
    for word in words:
        assert starts_with_target(word, sound), f"{word!r} does not start with /{sound}/"


def test_an_english_speaker_gets_no_cross_language_anchor():
    """English-only mode is not a degraded path — there is simply nothing to
    bridge from, so the progression starts at the target sound."""
    bridge = L.bridge_for("en", "th")

    assert bridge.anchor is None
    assert bridge.progression == ["θ", "think", "three", "through"]


def test_a_sound_with_no_researched_bridge_returns_none():
    """Better an absent bridge than an invented one."""
    assert L.bridge_for("bn", "zz") is None


# ── No causal claims ─────────────────────────────────────────────────

#: Wording that would turn a description of two languages into a claim about
#: a person, or into a deficit account of a language. The feature is framed as
#: personalization, and these are the words that quietly un-frame it.
CAUSAL_OR_DEFICIT = [
    r"\bbecause\b", r"\bcauses?\b", r"\bcaused by\b", r"\bdue to\b",
    r"\blacks?\b", r"\blacking\b", r"\bmissing\b", r"\bdoes not have\b",
    r"\bdoesn't have\b", r"\bno such sound\b", r"\bdeficien\w*",
    r"\bstruggle\w*", r"\bdifficult(?:y| for)\b", r"\bproblem\b",
    r"\bcannot (?:say|produce|make)\b", r"\bunable to\b",
    r"\binterference\b", r"\bnegative transfer\b",
    r"\bwill (?:say|produce|substitute)\b", r"\btend to\b",
]


def bridge_copy() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for native in ("bn", "en"):
        for sound in ("s", "r", "l", "th"):
            bridge = L.bridge_for(native, sound)
            if bridge is None:  # pragma: no cover - all four exist
                continue
            if bridge.anchor_note:
                out.append((f"{native}/{sound} anchor", bridge.anchor_note))
            for step in bridge.steps:
                if step.note:
                    out.append((f"{native}/{sound} step {step.text}", step.note))
    for code in L.LANGUAGES:
        note = L.language(code).target_note
        if note:
            out.append((f"{code} target_note", note))
    return out


@pytest.mark.parametrize(("where", "text"), bridge_copy())
def test_no_bridge_copy_makes_a_causal_or_deficit_claim(where, text):
    found = [p for p in CAUSAL_OR_DEFICIT if re.search(p, text, re.IGNORECASE)]
    assert not found, f"{where} uses {found}: {text!r}"


def test_the_generator_is_told_not_to_explain_pronunciation_by_language():
    """
    The system prompt is the only standing instruction the model gets, so its
    wording is part of the safety surface.
    """
    system = material._SYSTEM.lower()

    assert "causes, explains, or predicts" in system
    assert "lacking" in system and "deficient" in system


def test_the_language_clause_is_context_not_explanation():
    from app.journey.stages import stage

    prompt = material._user_prompt("th", stage(3), None, "bn")

    assert "first language is Bangla" in prompt
    assert "must still be an English word" in prompt
    assert "Do not explain their pronunciation" in prompt


def test_an_english_speaker_gets_no_language_clause():
    from app.journey.stages import stage

    assert "first language is" not in material._user_prompt("th", stage(3), None, "en")


# ── The pipeline must not move ───────────────────────────────────────


def test_the_acoustic_stage_takes_no_language_argument():
    """
    Structural, not behavioural. There is no parameter through which a first
    language could reach the measurement, so no future caller can pass one by
    accident.
    """
    params = set(inspect.signature(analyze).parameters)

    assert params == {"audio", "target", "expected_text", "position"}
    assert not any("lang" in p for p in params)


@pytest.mark.parametrize("native", ["en", "bn"])
def test_the_same_recording_scores_identically_whatever_the_first_language(
    client, sank_wav, native
):
    """
    The behavioural half of the same guarantee, through the real endpoint:
    two learners, different first languages, byte-identical audio, identical
    measurement.
    """
    client.put(f"/api/journey/learner-{native}/profile", json={"native_language": native})
    response = client.post(
        f"/api/journey/learner-{native}/s/attempt",
        files={"audio": ("attempt.wav", sank_wav, "audio/wav")},
        data={"prompt_text": "sank"},
    )

    assert response.status_code == 200
    analysis = response.json()["analysis"]
    # Compared against the direct call, which knows nothing about journeys or
    # languages at all.
    direct = analyze(sank_wav, "s", expected_text="sank")

    assert analysis["similarity_score"] == direct.similarity_score
    assert analysis["estimated_match"] == direct.estimated_match
    assert analysis["confidence"] == direct.confidence


def test_there_is_exactly_one_reference_set_and_it_is_english():
    """
    Nothing about a learner's first language can select a different reference
    set, because only one exists. If per-language references are ever added,
    this test should fail and be replaced by one that checks the selection is
    driven by the *target* language, never the native one.
    """
    from app.acoustic import profiles

    reference = profiles.load()

    assert reference.provenance["source"].startswith("Windows SAPI")
    assert reference.provenance["voices"] == [
        "Microsoft David Desktop",
        "Microsoft Zira Desktop",
    ]
    # A non-English language is configured, and it still gets these profiles.
    assert set(L.LANGUAGES) - {"en"}
    assert profiles.load() is reference, "the reference set is process-wide, not per learner"


# ── The endpoints ────────────────────────────────────────────────────


def test_a_new_learner_is_english_only(client):
    body = client.get("/api/journey/fresh/profile").json()

    assert body["language"]["native"]["code"] == "en"
    assert body["language"]["target"]["code"] == "en"
    assert body["language"]["cross_language"] is False


def test_setting_bangla_persists_and_applies_across_sounds(client):
    client.put("/api/journey/bn1/profile", json={"native_language": "bn"})

    for sound in ("s", "r", "l", "th"):
        language = client.get(f"/api/journey/bn1/{sound}").json()["language"]
        assert language["native"]["code"] == "bn"
        assert language["cross_language"] is True
        assert language["bridge"] is not None


def test_the_journey_reports_the_bangla_th_bridge(client):
    client.put("/api/journey/bn2/profile", json={"native_language": "bn"})

    bridge = client.get("/api/journey/bn2/th").json()["language"]["bridge"]

    assert bridge["progression"] == ["থ", "θ", "think", "three", "through"]
    assert bridge["anchor"] == "থ"


def test_the_target_is_always_english(client):
    """Whatever the first language, the sound being measured is an English one."""
    client.put("/api/journey/bn3/profile", json={"native_language": "bn"})
    body = client.get("/api/journey/bn3/th").json()

    assert body["language"]["target"]["code"] == "en"


def test_an_unknown_language_is_normalised_not_rejected(client):
    response = client.put("/api/journey/odd/profile", json={"native_language": "klingon"})

    assert response.status_code == 200
    assert response.json()["applied"] == "en"
    assert response.json()["requested"] == "klingon"


def test_the_language_choice_survives_a_restart(client, tmp_path):
    client.put("/api/journey/bn4/profile", json={"native_language": "bn"})

    from app.journey.store import get_store

    get_store().close()
    reopened = JourneyStore(tmp_path / "journey.db")
    set_store(reopened)

    assert client.get("/api/journey/bn4/profile").json()["language"]["native"]["code"] == "bn"


def test_the_languages_endpoint_frames_the_feature_as_personalization(client):
    body = client.get("/api/journey/languages").json()

    assert "personalize practice" in body["note"]
    assert [lang["code"] for lang in body["target"]] == ["en"]
    assert {lang["code"] for lang in body["native"]} == {"en", "bn"}


def test_material_reports_the_language_it_was_generated_for(client):
    client.put("/api/journey/bn5/profile", json={"native_language": "bn"})
    body = client.post("/api/journey/bn5/s/material", json={}).json()

    assert body["material"]["native_language"] == "bn"
    assert body["material"]["target_language"] == "en"
    assert body["language"]["bridge"]["anchor"] == "স"


@pytest.mark.parametrize("native", ["en", "bn"])
@pytest.mark.parametrize("sound", ["s", "r", "l", "th"])
def test_the_fallback_bank_serves_every_language_and_sound(native, sound):
    """
    The bank is English words either way. What the first language changes is
    the bridge shown beside them, not the words themselves — there is no
    reason for the words that isolate an English /s/ to differ by audience.
    """
    for stage in STAGES:
        item = material.fallback(sound, stage.index, native=native)
        assert item.native_language == native
        assert item.target_language == "en"
        assert starts_with_target(item.item.text, sound)
