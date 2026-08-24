"""
The Sound Journey — seven stages of linguistic complexity per target sound.

The progression runs from the sound in isolation to the sound in running
speech. Each step adds exactly one kind of difficulty, so that when a learner
stops succeeding it is clear what got harder:

    1  isolated      the sound alone, held                    "ssss"
    2  syllable      the sound joined to a vowel              "sa", "see"
    3  word_simple   one short word, sound at the start       "sun"
    4  word_complex  a longer word, or the sound not first    "seven"
    5  phrase        two or three words together              "silver snake"
    6  sentence      a short sentence                          -
    7  conversation  a natural spoken answer                   -

Stages 1 and 2 are both "the sound on its own" in the product's terms and
share a band; the difference is that stage 1 is a sustained sound with no
vowel to hide behind, and stage 2 is the first time it has to be released
into one. That transition is where a lot of /s/ and /r/ practice actually
breaks down, which is why it gets its own step.

The five **bands** are the visible journey. Seven dots is too many to read at
a glance, and the band boundaries are the ones a learner would describe
themselves: sound, word, phrase, sentence, conversation.
"""

from __future__ import annotations

from dataclasses import dataclass

#: The visible progression. Order matters — this is the display order.
BANDS: tuple[str, ...] = ("sound", "word", "phrase", "sentence", "conversation")

BAND_LABELS: dict[str, str] = {
    "sound": "Sound",
    "word": "Word",
    "phrase": "Phrase",
    "sentence": "Sentence",
    "conversation": "Conversation",
}


@dataclass(frozen=True)
class Stage:
    #: 1-based. `0` is never a stage; `index` is what gets persisted.
    index: int
    key: str
    band: str
    title: str
    #: Shown to the learner as the task for this stage.
    instruction: str
    #: What kind of material the generator should produce.
    material: str
    #: Roughly how long an attempt at this stage should be. Used to set
    #: expectations in the UI, not to gate anything.
    expected_duration_s: float


STAGES: tuple[Stage, ...] = (
    Stage(
        1, "isolated", "sound",
        "The sound on its own",
        "Hold the sound steady for about two seconds.",
        "isolated", 2.0,
    ),
    Stage(
        2, "syllable", "sound",
        "The sound with a vowel",
        "Say the sound joined to a vowel, smoothly, without a pause between them.",
        "syllable", 1.5,
    ),
    Stage(
        3, "word_simple", "word",
        "A short word",
        "Say the whole word once, at a comfortable speed.",
        "word", 1.5,
    ),
    Stage(
        4, "word_complex", "word",
        "A longer word",
        "Say the whole word once. Keep the target sound as clear as it was on its own.",
        "word_complex", 2.0,
    ),
    Stage(
        5, "phrase", "phrase",
        "Two or three words",
        "Say the phrase in one breath, without pausing between the words.",
        "phrase", 2.5,
    ),
    Stage(
        6, "sentence", "sentence",
        "A short sentence",
        "Say the sentence at a natural speaking pace.",
        "sentence", 4.0,
    ),
    Stage(
        7, "conversation", "conversation",
        "Natural speech",
        "Answer the question in your own words, in a sentence or two.",
        "conversation", 6.0,
    ),
)

FIRST_STAGE = STAGES[0].index
LAST_STAGE = STAGES[-1].index

_BY_INDEX = {stage.index: stage for stage in STAGES}


def stage(index: int) -> Stage:
    """The stage at `index`, clamped into range rather than raising."""
    return _BY_INDEX[max(FIRST_STAGE, min(LAST_STAGE, int(index)))]


def band_index(index: int) -> int:
    """Which of the five visible dots a stage lights up."""
    return BANDS.index(stage(index).band)


def as_dict(index: int) -> dict:
    current = stage(index)
    return {
        "index": current.index,
        "key": current.key,
        "band": current.band,
        "band_label": BAND_LABELS[current.band],
        "band_index": band_index(index),
        "title": current.title,
        "instruction": current.instruction,
        "material": current.material,
        "expected_duration_s": current.expected_duration_s,
        "is_first": current.index == FIRST_STAGE,
        "is_last": current.index == LAST_STAGE,
    }


def band_map() -> list[dict]:
    """
    The five journey dots, each with the stages it covers.

    The UI renders this rather than hard-coding the labels, so the journey
    display cannot drift out of step with the stage list.
    """
    return [
        {
            "band": band,
            "label": BAND_LABELS[band],
            "index": position,
            "stages": [s.index for s in STAGES if s.band == band],
        }
        for position, band in enumerate(BANDS)
    ]
