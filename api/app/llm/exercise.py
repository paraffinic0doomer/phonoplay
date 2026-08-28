"""
Personalized practice, generated from measured pronunciation evidence.

The one-way rule this module exists to keep:

    audio -> acoustic analysis -> learner model -> EVIDENCE -> this module
                                                                   |
                                                                   v
                                                              exercise text
                                                                   |
                                                    never flows back into a score

The generator is *told* what was measured and writes practice around it. It
never produces a measurement, and there is no field in any output schema a
score could occupy: every generated value is a string, `extra="forbid"` makes
an unexpected `score` key a validation failure rather than a silent extra, and
a regex scan rejects percentages and clinical wording before anything is shown.

How much repetition a learner needs is decided by the learner model, not here.
The generator writes the words; the policy decides the dose.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..config import Settings
from ..journey.material import starts_with_target

log = logging.getLogger(__name__)

SUPPORTED: tuple[str, ...] = ("s", "r", "l", "th")

IPA: dict[str, str] = {"s": "s", "r": "ɹ", "l": "l", "th": "θ"}


# ── What the generator is told ───────────────────────────────────────


class ExerciseEvidence(BaseModel):
    """
    The learner state the generator writes against.

    Every field is something the acoustic stage or the learner model
    produced. The generator reads them and never writes them back.

    Sent by the client rather than looked up here: the learner model lives in
    the browser's IndexedDB (CLAUDE.md — local persistence, no accounts), so
    the server has no row to read. That also keeps this endpoint stateless.
    """

    model_config = ConfigDict(extra="forbid")

    target_phoneme: Literal["s", "r", "l", "th"]
    #: 0-1, from the learner model. None before anything was measured.
    mastery: float | None = Field(default=None, ge=0.0, le=1.0)
    #: 0-1. The analyser's confidence in its own readings, not the learner's.
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    #: Most recent similarities, oldest first. Bounded so the prompt cannot grow.
    recent_scores: list[float] = Field(default_factory=list, max_length=10)
    current_stage: str = Field(default="word", max_length=32)
    learning_mode: Literal["standard", "accessibility"] = "standard"
    exercise_type: str = Field(default="production", max_length=32)
    #: 0-1 over minimal-pair answers for this sound, when any were given.
    contrast_accuracy: float | None = Field(default=None, ge=0.0, le=1.0)
    native_language: str = Field(default="en", max_length=32)
    target_language: str = Field(default="en", max_length=32)

    @field_validator("recent_scores")
    @classmethod
    def _bounded(cls, scores: list[float]) -> list[float]:
        return [max(0.0, min(1.0, float(s))) for s in scores]

    def summary(self) -> dict[str, Any]:
        """
        What actually goes into the prompt.

        Rounded and plain. The generator gets enough to pitch the difficulty
        and nothing it could quote back as a measurement.
        """
        return {
            "target_sound": self.target_phoneme,
            "mastery": None if self.mastery is None else round(self.mastery, 2),
            "analyser_confidence": None
            if self.confidence is None
            else round(self.confidence, 2),
            "recent_scores": [round(s, 2) for s in self.recent_scores],
            "current_stage": self.current_stage,
            "learning_mode": self.learning_mode,
            "exercise_type": self.exercise_type,
            "minimal_pair_accuracy": None
            if self.contrast_accuracy is None
            else round(self.contrast_accuracy, 2),
            "first_language": self.native_language,
            "practising": self.target_language,
        }


# ── What the generator may return ────────────────────────────────────


class ExerciseItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=40)
    target_ipa: str = Field(min_length=1, max_length=4)
    contrast: str | None = Field(default=None, max_length=40)
    prompt_id: str | None = Field(default=None, max_length=64)


class StandardExercise(BaseModel):
    """Standard Mode: words, connected speech, and something to aim at."""

    model_config = ConfigDict(extra="forbid")

    explanation: str = Field(min_length=1, max_length=240)
    words: list[ExerciseItem] = Field(min_length=3, max_length=3)
    phrase: str = Field(min_length=1, max_length=120)
    sentence: str = Field(min_length=1, max_length=160)
    challenge: str = Field(min_length=1, max_length=160)
    encouragement: str = Field(min_length=1, max_length=160)


class MinimalPairItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: str = Field(min_length=1, max_length=40)
    contrast: str = Field(min_length=1, max_length=40)
    cue: str = Field(min_length=1, max_length=120)


class AccessibilityExercise(BaseModel):
    """
    Accessibility Mode: smaller steps, and one thing at a time.

    Shorter caps throughout, two words rather than three, the sound on its own
    before it appears in a word, and an explicit next step so the progression
    is visible rather than implied. No phrase or sentence — those are later
    rungs, and putting them on the same card would be the opposite of a
    smaller step.

    `repeat_cue` is words, not a number. How many repetitions a learner needs
    is a policy decision the learner model owns.
    """

    model_config = ConfigDict(extra="forbid")

    explanation: str = Field(min_length=1, max_length=140)
    isolation: str = Field(min_length=1, max_length=120)
    words: list[ExerciseItem] = Field(min_length=2, max_length=2)
    minimal_pair: MinimalPairItem
    repeat_cue: str = Field(min_length=1, max_length=120)
    next_step: str = Field(min_length=1, max_length=120)
    encouragement: str = Field(min_length=1, max_length=140)


Exercise = StandardExercise  # kept for existing imports


# ── Guards applied after the schema ──────────────────────────────────

#: Words that would make this a claim about a person rather than practice.
_FORBIDDEN = re.compile(
    r"\b(dyslexi\w*|disorder\w*|diagnos\w*|impair\w*|therap\w*|treatment|"
    r"deficit|abnormal|disabilit\w*|symptom\w*|patholog\w*|clinical|"
    r"screening|assessment score|your score)\b",
    re.IGNORECASE,
)

#: Anything shaped like a measurement the generator has no business producing.
_NUMERIC = re.compile(r"\d+\s*%|\b\d+\s*(?:out of|/)\s*\d+\b|\bscore[sd]?\b", re.IGNORECASE)


def _strings(payload: Any) -> list[str]:
    """Every string anywhere in the generated object."""
    if isinstance(payload, str):
        return [payload]
    if isinstance(payload, dict):
        return [s for value in payload.values() for s in _strings(value)]
    if isinstance(payload, list):
        return [s for value in payload for s in _strings(value)]
    return []


class RejectedExercise(ValueError):
    """Generated content that passed the schema but failed a guard."""


def check_content(payload: dict[str, Any], target: str) -> None:
    """
    Everything the schema cannot express.

    Raises RejectedExercise, which the caller turns into a fallback. Rejecting
    is always safe here: the fallback bank covers every sound, so a refusal
    costs a learner nothing but a less tailored card.
    """
    for text in _strings(payload):
        if _FORBIDDEN.search(text):
            raise RejectedExercise(f"clinical or diagnostic wording: {text[:60]!r}")
        if _NUMERIC.search(text):
            raise RejectedExercise(f"reads like a measurement: {text[:60]!r}")

    # The acoustic stage looks for the target at the start of the utterance.
    # Material whose first word does not begin with it would be scored against
    # a sound that is not there — the generator quietly breaking the measurement.
    for word in payload.get("words", []):
        text = word.get("text", "") if isinstance(word, dict) else ""
        if not starts_with_target(text, target):
            raise RejectedExercise(f"{text!r} does not begin with /{target}/")

    for key in ("phrase", "sentence", "isolation"):
        value = payload.get(key)
        if isinstance(value, str) and value and not starts_with_target(value, target):
            raise RejectedExercise(f"{key} {value!r} does not begin with /{target}/")

    pair = payload.get("minimal_pair")
    if isinstance(pair, dict):
        if not starts_with_target(pair.get("target", ""), target):
            raise RejectedExercise("minimal pair target does not begin with the sound")
        if starts_with_target(pair.get("contrast", ""), target):
            raise RejectedExercise("minimal pair contrast is the same sound")


# ── The deterministic bank ───────────────────────────────────────────
#
# Every sound, both modes. No key, no network, a timeout, a malformed
# response, or a rejected one all land here, so a demo never depends on a
# network call and a learner always gets something to practise.

_STANDARD: dict[str, StandardExercise] = {
    "s": StandardExercise(
        explanation="Keep a narrow stream of air behind your top teeth.",
        words=[
            ExerciseItem(text="sun", target_ipa="s", prompt_id="s_word_sun"),
            ExerciseItem(text="sock", target_ipa="s", prompt_id="s_word_sock"),
            ExerciseItem(text="sing", target_ipa="s", contrast="thing"),
        ],
        phrase="Six silver socks",
        sentence="Sam sees the sun.",
        challenge="Say each word slowly, then the phrase, keeping the air steady.",
        encouragement="Your careful airflow is the skill to keep building.",
    ),
    "r": StandardExercise(
        explanation="Pull the tongue back and keep the lips relaxed.",
        words=[
            ExerciseItem(text="red", target_ipa="ɹ", prompt_id="r_word_red"),
            ExerciseItem(text="rabbit", target_ipa="ɹ", prompt_id="r_word_rabbit"),
            ExerciseItem(text="ring", target_ipa="ɹ", contrast="wing"),
        ],
        phrase="Red rabbits running",
        sentence="Rain fell on the road.",
        challenge="Alternate slow and natural speed without rounding your lips.",
        encouragement="A steady tongue shape makes this clearer every time.",
    ),
    "l": StandardExercise(
        explanation="Touch the ridge behind your top teeth and let air flow around the tongue.",
        words=[
            ExerciseItem(text="lion", target_ipa="l", prompt_id="l_word_lion"),
            ExerciseItem(text="leaf", target_ipa="l", prompt_id="l_word_leaf"),
            ExerciseItem(text="light", target_ipa="l", contrast="right"),
        ],
        phrase="Lily likes lemons",
        sentence="Look at the little lake.",
        challenge="Hold the tongue contact briefly at the start of each word.",
        encouragement="Keep that clear tongue-tip contact.",
    ),
    "th": StandardExercise(
        explanation="Place the tongue lightly between the teeth and use gentle airflow.",
        words=[
            ExerciseItem(text="thumb", target_ipa="θ", prompt_id="th_word_thumb"),
            ExerciseItem(text="think", target_ipa="θ", prompt_id="th_word_think"),
            ExerciseItem(text="three", target_ipa="θ", contrast="tree"),
        ],
        phrase="Three thin threads",
        sentence="Thank you for the third one.",
        challenge="Whisper the phrase first, then say it normally.",
        encouragement="Gentle airflow is more useful here than force.",
    ),
}

_ACCESSIBILITY: dict[str, AccessibilityExercise] = {
    "s": AccessibilityExercise(
        explanation="A long, quiet hiss.",
        isolation="sssss — hold it for three seconds",
        words=[
            ExerciseItem(text="sun", target_ipa="s", prompt_id="s_word_sun"),
            ExerciseItem(text="sock", target_ipa="s", prompt_id="s_word_sock"),
        ],
        minimal_pair=MinimalPairItem(
            target="sing", contrast="thing", cue="One hisses. One is softer."
        ),
        repeat_cue="Say the sound, then the word. Twice each.",
        next_step="When it feels easy, try it inside a short phrase.",
        encouragement="Slow is exactly right here.",
    ),
    "r": AccessibilityExercise(
        explanation="Tongue back, lips relaxed.",
        isolation="rrrrr — keep your lips still",
        words=[
            ExerciseItem(text="red", target_ipa="ɹ", prompt_id="r_word_red"),
            ExerciseItem(text="rug", target_ipa="ɹ"),
        ],
        minimal_pair=MinimalPairItem(
            target="rake", contrast="lake", cue="One touches the roof of your mouth."
        ),
        repeat_cue="Sound first, then the word. Twice each.",
        next_step="When the word feels steady, add a second word after it.",
        encouragement="Every repetition is doing something.",
    ),
    "l": AccessibilityExercise(
        explanation="Tongue tip up, air around the sides.",
        isolation="llll — feel the tip touch",
        words=[
            ExerciseItem(text="leaf", target_ipa="l", prompt_id="l_word_leaf"),
            ExerciseItem(text="lion", target_ipa="l", prompt_id="l_word_lion"),
        ],
        minimal_pair=MinimalPairItem(
            target="light", contrast="right", cue="One touches. One does not."
        ),
        repeat_cue="Say the sound, then the word. Twice each.",
        next_step="Next, two words in a row without stopping.",
        encouragement="That tongue-tip contact is the whole skill.",
    ),
    "th": AccessibilityExercise(
        explanation="Tongue between the teeth, very gentle air.",
        isolation="thhh — barely any sound",
        words=[
            ExerciseItem(text="thumb", target_ipa="θ", prompt_id="th_word_thumb"),
            ExerciseItem(text="think", target_ipa="θ", prompt_id="th_word_think"),
        ],
        minimal_pair=MinimalPairItem(
            target="thin", contrast="tin", cue="One flows. One stops."
        ),
        repeat_cue="Sound first, then the word. Twice each.",
        next_step="When it feels easy, try two words together.",
        encouragement="Gentle beats loud for this one.",
    ),
}


def bank(target: str, mode: str = "standard") -> dict[str, Any]:
    """The deterministic exercise for a sound in a mode."""
    if target not in SUPPORTED:
        raise ValueError(f"unsupported target sound {target!r}")
    source = _ACCESSIBILITY if mode == "accessibility" else _STANDARD
    return source[target].model_dump()


def fallback(target: str, attempt_id: str = "fallback", mode: str = "standard") -> dict[str, Any]:
    """A complete response built from the bank."""
    content = bank(target, mode)
    words = content["words"]
    return {
        "id": f"fallback-ex-{attempt_id}",
        "attempt_id": attempt_id,
        "target_sound": target,
        "learning_mode": mode,
        "deviation_label": None,
        "title": f"Practise /{IPA[target]}/",
        "cue": content["explanation"],
        "activity_type": "isolation" if mode == "accessibility" else "production",
        "items": words,
        "difficulty": 1,
        "source": "fallback",
        "content": content,
    }


# ── Talking to the model ─────────────────────────────────────────────

_SYSTEM = (
    "You write short pronunciation practice for a language learner. "
    "You are given measurements produced by a separate acoustic system. "
    "That system owns every number: never output a score, a percentage, a "
    "rating, or any figure describing how well the learner performed. "
    "Never mention any medical or learning condition, diagnosis, disorder, "
    "therapy or assessment. Write only practice material and encouragement. "
    "Return a single JSON object and nothing else."
)


#: Extra instruction for /th/, and the reason it is needed.
#:
#: English sentences naturally open with "The" or "This", and those are the
#: *voiced* TH — a different sound from the one the reference corpus is built
#: from. Without saying so, every generated /th/ sentence began with an
#: article and was rejected by the content guard, so /th/ fell back to the
#: bank on every single call. Measured against the live model: 0 of 3
#: generated before this line, 4 of 4 after.
_TH_NOTE = (
    "\n\nCRITICAL for this sound: English has two TH sounds spelled the same. "
    "You are writing for the voiceless one, as in THIN, THINK, THREE, THUMB. "
    "NEVER begin any word, phrase or sentence with the voiced TH: not 'the', "
    "'this', 'that', 'these', 'those', 'they', 'their', 'there', 'then', "
    "'than', 'though'. Start every line with a voiceless TH word instead."
)


def _standard_prompt(evidence: ExerciseEvidence) -> str:
    target = evidence.target_phoneme
    return (
        f"Write practice for the English /{target}/ sound.\n"
        f"Evidence from the acoustic system (authoritative, do not restate as numbers): "
        f"{json.dumps(evidence.summary())}\n\n"
        "Return JSON with exactly these keys:\n"
        '  explanation  one sentence on how the sound is made\n'
        '  words        exactly 3 objects: {text, target_ipa, contrast, prompt_id}\n'
        '  phrase       2-4 words\n'
        '  sentence     one short sentence\n'
        '  challenge    one sentence telling them what to aim for\n'
        '  encouragement one warm sentence\n\n'
        f"Every word, the phrase and the sentence MUST begin with the /{target}/ "
        "sound, because the analyser listens at the start of the utterance. "
        "Use real English words. Set contrast to a real near-identical word "
        "with a different first sound, or null. Set prompt_id to null."
        + (_TH_NOTE if target == "th" else "")
    )


def _accessibility_prompt(evidence: ExerciseEvidence) -> str:
    target = evidence.target_phoneme
    return (
        f"Write gentle, small-step practice for the English /{target}/ sound.\n"
        f"Evidence from the acoustic system (authoritative, do not restate as numbers): "
        f"{json.dumps(evidence.summary())}\n\n"
        "Keep every line short and the vocabulary simple and common. One idea "
        "per line. Warm, calm tone. Never imply anything is wrong.\n\n"
        "Return JSON with exactly these keys:\n"
        '  explanation   one very short sentence, plain words\n'
        '  isolation     the sound on its own with a physical cue\n'
        '  words         exactly 2 objects: {text, target_ipa, contrast, prompt_id}\n'
        '  minimal_pair  {target, contrast, cue} - two real words differing only in the first sound\n'
        '  repeat_cue    how to repeat it, in words not numbers\n'
        '  next_step     the one small thing that comes after this\n'
        '  encouragement one warm sentence\n\n'
        f"Every word, the isolation line and minimal_pair.target MUST begin with "
        f"the /{target}/ sound. minimal_pair.contrast must NOT. Use short, "
        "everyday words. Set prompt_id to null."
        + (_TH_NOTE if target == "th" else "")
    )


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip().removeprefix("```json").removesuffix("```").strip()
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("generator returned a non-object")
    return value


async def generate(
    evidence: ExerciseEvidence | dict[str, Any],
    settings: Settings,
    attempt_id: str = "unknown",
) -> dict[str, Any]:
    """
    Generate an exercise, or return the bank.

    Never raises for a generation failure. Every path that cannot produce
    validated content returns the deterministic exercise with
    `source: "fallback"`, which is stored and shown so a learner can always
    see where their practice came from.
    """
    if isinstance(evidence, dict):
        evidence = ExerciseEvidence.model_validate(evidence)

    target = evidence.target_phoneme
    mode = evidence.learning_mode
    base = fallback(target, attempt_id, mode)

    keys = settings.groq_api_key_pool
    if not keys:
        return base

    schema = AccessibilityExercise if mode == "accessibility" else StandardExercise
    prompt = (
        _accessibility_prompt(evidence)
        if mode == "accessibility"
        else _standard_prompt(evidence)
    )

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            for key in keys:
                try:
                    response = await client.post(
                        f"{settings.groq_base_url.rstrip('/')}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            # groq_chat_model, never groq_model: the latter is
                            # Whisper, and /chat/completions rejects it with a
                            # 400 that the except below would swallow.
                            "model": settings.groq_chat_model,
                            "temperature": 0.3,
                            # Room for the reasoning trace gpt-oss-120b emits
                            # before its JSON. Below ~800 the budget runs out
                            # mid-thought and Groq returns json_validate_failed
                            # with an empty generation.
                            "max_tokens": 1200,
                            "response_format": {"type": "json_object"},
                            "messages": [
                                {"role": "system", "content": _SYSTEM},
                                {"role": "user", "content": prompt},
                            ],
                        },
                    )
                    response.raise_for_status()
                    content = response.json()["choices"][0]["message"]["content"]

                    payload = _extract_json(content)
                    generated = schema.model_validate(payload)
                    # Schema first, then the guards the schema cannot express.
                    check_content(generated.model_dump(), target)

                    base.update(
                        {
                            "content": generated.model_dump(),
                            "items": [item.model_dump() for item in generated.words],
                            "cue": generated.explanation,
                            "source": "llm",
                        }
                    )
                    return base
                except RejectedExercise as rejected:
                    # Worth a log line: a model that keeps producing rejected
                    # content is a prompt problem, and it is invisible
                    # otherwise because the learner just sees the bank.
                    log.warning("generated exercise rejected: %s", rejected)
                    return base
                except (
                    httpx.HTTPError,
                    KeyError,
                    IndexError,
                    TypeError,
                    ValueError,
                    json.JSONDecodeError,
                ) as failure:
                    log.info("exercise generation attempt failed: %s", failure)
                    continue
        return base
    except Exception:  # noqa: BLE001 - a practice card is never worth a 500
        return base
