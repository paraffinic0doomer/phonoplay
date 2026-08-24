"""
Languages, and what a learner's first language is allowed to affect.

PhonoPlay can personalize practice for learners whose first language differs
from their target language. The whole of that personalization happens in
three places, and it is worth being precise about which:

    1. the interface       — names, scripts, and which sounds are offered
    2. the bridge          — a familiar sound used as a starting point
    3. the material prompt — context given to the exercise generator

It affects **nothing else**. In particular the first language is never an
input to the acoustic measurement. A learner practising English /θ/ is
measured against the English /θ/ reference profile whoever they are, and
`acoustic.analyze()` has no parameter through which a language could reach
it. That is deliberate on two counts:

  * **It keeps the measurement stable.** Adding a language cannot change what
    an existing recording scores.
  * **It is the only honest option.** The reference profiles are built from
    English audio (see `acoustic/reference/README.md`). We have no Bangla
    acoustic data, so Bangla can be a *native* language here but not a
    *target* one, and the registry below says so rather than pretending
    otherwise.

## On causation

Nothing in this module claims that a learner's first language causes any
pronunciation pattern. That claim is not ours to make: it would require
evidence about individual learners that a two-second recording cannot supply,
and stated carelessly it turns a description of a language into a prediction
about a person.

What the bridges below *do* say is narrower and checkable: that a particular
sound in one language is articulated in a particular place, and that a
particular sound in another language shares that place. "থ puts the tongue
tip at the teeth, and so does /θ/" is a description of two articulations. It
is useful precisely because it gives a learner somewhere familiar to start —
not because it predicts anything about what they will do.

Not to be confused with `app/stt/languages.py`, which is an internal helper
of the transcription package that maps provider language names to ISO-639-1
codes. This module is the product-level registry: which languages a learner
can choose, and what choosing one is allowed to change.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Language:
    code: str
    #: English name, for English-language interface copy.
    name: str
    #: The language's own name in its own script.
    native_name: str
    script: str
    #: Whether PhonoPlay can *measure* pronunciation in this language. False
    #: means "no acoustic reference data", not "less important".
    can_be_target: bool
    #: Whether it can be selected as a learner's first language.
    can_be_native: bool
    #: Shown in the picker when `can_be_target` is False, so the limitation is
    #: visible at the point it matters rather than buried in a doc.
    target_note: str | None = None


LANGUAGES: dict[str, Language] = {
    "en": Language(
        code="en",
        name="English",
        native_name="English",
        script="Latin",
        can_be_target=True,
        can_be_native=True,
    ),
    "bn": Language(
        code="bn",
        name="Bangla",
        native_name="বাংলা",
        script="Bengali",
        # PhonoPlay measures English sounds against English reference audio.
        # There is no Bangla reference data, so there is nothing to measure a
        # Bangla target against, and inventing one would be the exact
        # fabrication this project refuses.
        can_be_target=False,
        can_be_native=True,
        target_note=(
            "PhonoPlay does not measure Bangla pronunciation yet — the "
            "acoustic reference data is English only. Bangla can be your "
            "first language here, and practice is personalized for it."
        ),
    ),
}

DEFAULT_NATIVE = "en"
DEFAULT_TARGET = "en"


@dataclass(frozen=True)
class BridgeStep:
    """One step on the way from a familiar sound to the target."""

    #: What the learner sees. A grapheme, an IPA symbol, or a word.
    text: str
    #: "native" | "target" | "word"
    kind: str
    #: IPA for the sound this step is about, where there is a single one.
    ipa: str | None = None
    #: One line about what changes at this step.
    note: str | None = None


@dataclass(frozen=True)
class Bridge:
    """
    A familiar starting point for one target sound, for one first language.

    `anchor_note` describes an articulatory relationship between two sounds.
    It is not a claim about what any learner does or will do.
    """

    native: str
    target_sound: str
    #: The familiar grapheme, or None when the learner's first language is
    #: also the target language and there is nothing to bridge from.
    anchor: str | None
    anchor_ipa: str | None
    anchor_note: str | None
    steps: list[BridgeStep] = field(default_factory=list)

    @property
    def progression(self) -> list[str]:
        return [step.text for step in self.steps]


def _words(*pairs: tuple[str, str]) -> list[BridgeStep]:
    return [BridgeStep(text=text, kind="word", note=note) for text, note in pairs]


#: Bangla-to-English bridges.
#:
#: Every anchor below is a **shared place of articulation**, stated as a
#: description of two articulations rather than a prediction about a speaker.
#: Bangla's dental stop series (ত থ দ ধ) is laminal dental, the same region
#: English /θ/ uses; ল and English /l/ both make alveolar contact; র is an
#: alveolar tap or trill in the same region English /ɹ/ approaches.
#:
#: Every word in every progression begins with the target sound, which the
#: journey requires: the acoustic stage measures the onset of the utterance
#: (ARCHITECTURE.md §15), so a progression word that did not start with the
#: sound would be unmeasurable.
_BN_EN: dict[str, Bridge] = {
    "th": Bridge(
        native="bn",
        target_sound="th",
        anchor="থ",
        anchor_ipa="t̪ʰ",
        anchor_note=(
            "থ already puts your tongue tip at your teeth — the same place "
            "English /θ/ uses. The difference is what the air does: থ stops "
            "it, /θ/ keeps it flowing."
        ),
        steps=[
            BridgeStep("থ", "native", "t̪ʰ", "The place you already know."),
            BridgeStep("θ", "target", "θ", "Same place. Let the air keep going."),
            *_words(
                ("think", "The sound at the start of a word."),
                ("three", "Now with /r/ straight after it."),
                ("through", "The same cluster, a different vowel."),
            ),
        ],
    ),
    "s": Bridge(
        native="bn",
        target_sound="s",
        anchor="স",
        anchor_ipa="s ~ ʃ",
        anchor_note=(
            "স is written for a sibilant, and across Bangla varieties it is "
            "produced as [s] or as [ʃ]. English /s/ is consistently the "
            "higher, sharper of the two."
        ),
        steps=[
            BridgeStep("স", "native", "s ~ ʃ", "A sibilant you already make."),
            BridgeStep("s", "target", "s", "Narrow the groove; aim the air higher."),
            *_words(
                ("sun", "One syllable, sound at the start."),
                ("snake", "Now with a consonant straight after."),
                ("street", "A three-consonant cluster."),
            ),
        ],
    ),
    "r": Bridge(
        native="bn",
        target_sound="r",
        anchor="র",
        anchor_ipa="ɾ ~ r",
        anchor_note=(
            "র taps or trills the tongue against the ridge behind your top "
            "teeth. English /ɹ/ moves toward that same region but never "
            "makes contact."
        ),
        steps=[
            BridgeStep("র", "native", "ɾ ~ r", "The region you already use."),
            BridgeStep("ɹ", "target", "ɹ", "Approach, but do not touch."),
            *_words(
                ("red", "One syllable, sound at the start."),
                ("rain", "Hold the /r/ before the vowel."),
                ("rocket", "Two syllables, same opening sound."),
            ),
        ],
    ),
    "l": Bridge(
        native="bn",
        target_sound="l",
        anchor="ল",
        anchor_ipa="l",
        anchor_note=(
            "ল and English /l/ are both made with the tongue tip touching "
            "the ridge behind the top teeth. This is the closest pairing of "
            "the four."
        ),
        steps=[
            BridgeStep("ল", "native", "l", "Very close to the English sound."),
            BridgeStep("l", "target", "l", "Same contact, held a little longer."),
            *_words(
                ("light", "One syllable, sound at the start."),
                ("leaf", "Keep the contact firm before the vowel."),
                ("lemonade", "Three syllables, same opening sound."),
            ),
        ],
    ),
}

#: English-to-English: no cross-language anchor, so the progression starts at
#: the target sound itself. English-only mode is not a degraded path — it is
#: simply the case where there is nothing to bridge from.
_EN_EN: dict[str, Bridge] = {
    "th": Bridge("en", "th", None, None, None, [
        BridgeStep("θ", "target", "θ", "The sound on its own."),
        *_words(("think", "At the start of a word."),
                ("three", "Now with /r/ straight after it."),
                ("through", "The same cluster, a different vowel.")),
    ]),
    "s": Bridge("en", "s", None, None, None, [
        BridgeStep("s", "target", "s", "The sound on its own."),
        *_words(("sun", "At the start of a word."),
                ("snake", "With a consonant straight after."),
                ("street", "A three-consonant cluster.")),
    ]),
    "r": Bridge("en", "r", None, None, None, [
        BridgeStep("ɹ", "target", "ɹ", "The sound on its own."),
        *_words(("red", "At the start of a word."),
                ("rain", "Hold it before the vowel."),
                ("rocket", "Two syllables.")),
    ]),
    "l": Bridge("en", "l", None, None, None, [
        BridgeStep("l", "target", "l", "The sound on its own."),
        *_words(("light", "At the start of a word."),
                ("leaf", "Keep the contact firm."),
                ("lemonade", "Three syllables.")),
    ]),
}

_BRIDGES: dict[str, dict[str, Bridge]] = {"bn": _BN_EN, "en": _EN_EN}


def is_language(code: str) -> bool:
    return code in LANGUAGES


def language(code: str) -> Language:
    try:
        return LANGUAGES[code]
    except KeyError:
        raise ValueError(f"unknown language {code!r}") from None


def native_options() -> list[Language]:
    return [lang for lang in LANGUAGES.values() if lang.can_be_native]


def target_options() -> list[Language]:
    return [lang for lang in LANGUAGES.values() if lang.can_be_target]


def normalise_native(code: str | None) -> str:
    """Fall back to the default rather than raising on unknown input."""
    if code and code in LANGUAGES and LANGUAGES[code].can_be_native:
        return code
    return DEFAULT_NATIVE


def bridge_for(native: str, target_sound: str) -> Bridge | None:
    """
    The bridge for one sound, or None when there is no entry.

    Returning None is a normal outcome: a language pair with no researched
    bridge gets the plain target-language progression rather than an invented
    one.
    """
    return _BRIDGES.get(normalise_native(native), {}).get(target_sound)


def as_dict(bridge: Bridge | None) -> dict | None:
    if bridge is None:
        return None
    return {
        "native": bridge.native,
        "target_sound": bridge.target_sound,
        "anchor": bridge.anchor,
        "anchor_ipa": bridge.anchor_ipa,
        "anchor_note": bridge.anchor_note,
        "progression": bridge.progression,
        "steps": [
            {"text": s.text, "kind": s.kind, "ipa": s.ipa, "note": s.note}
            for s in bridge.steps
        ],
    }


def language_dict(code: str) -> dict:
    lang = language(code)
    return {
        "code": lang.code,
        "name": lang.name,
        "native_name": lang.native_name,
        "script": lang.script,
        "can_be_target": lang.can_be_target,
        "can_be_native": lang.can_be_native,
        "target_note": lang.target_note,
    }
