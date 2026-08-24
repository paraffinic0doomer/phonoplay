"""
The phoneme inventory this stage can reason about.

Deliberately tiny. Four practice targets and, for each, a short list of the
substitutions actually attested for English learners of that sound. Nothing
else is a candidate.

Keeping the candidate list short is not a shortcut — it is what makes the
reported result meaningful. An unconstrained "nearest phoneme" search over a
full inventory will always name *something*, and on a marginal recording that
something is whichever profile happened to sit closest in feature space. By
only ever choosing between the target and its documented alternatives, a
reported mismatch is a pattern a teacher would recognise, and anything that
fits none of them comes back as uncertain instead of as a wrong answer
delivered confidently.
"""

from __future__ import annotations

from dataclasses import dataclass

# The two feature families. These name *how a sound is measured here*, not
# its manner class — /t/ is a stop, but its burst is measured with the same
# frication spectrum features as /s/, so it lives in the fricative family.
FRICATIVE = "fricative"
APPROXIMANT = "approximant"


@dataclass(frozen=True)
class Phoneme:
    key: str
    ipa: str
    family: str
    #: Learner-facing name. Descriptive of the sound, never of the speaker.
    label: str


INVENTORY: dict[str, Phoneme] = {
    "s": Phoneme("s", "s", FRICATIVE, "the /s/ sound"),
    "th": Phoneme("th", "θ", FRICATIVE, "the /th/ sound as in “think”"),
    "sh": Phoneme("sh", "ʃ", FRICATIVE, "the /sh/ sound"),
    "f": Phoneme("f", "f", FRICATIVE, "the /f/ sound"),
    # A stop, not a fricative — see the note above the family constants.
    "t": Phoneme("t", "t", FRICATIVE, "the /t/ sound"),
    "r": Phoneme("r", "ɹ", APPROXIMANT, "the /r/ sound"),
    "l": Phoneme("l", "l", APPROXIMANT, "the /l/ sound"),
    "w": Phoneme("w", "w", APPROXIMANT, "the /w/ sound"),
}

#: The four targets PhonoPlay practises.
TARGETS: tuple[str, ...] = ("s", "r", "l", "th")

#: Documented substitution patterns, most common first.
#:
#:   /s/ → /θ/   dental placement of the sibilant; the classic frontal pattern
#:   /s/ → /ʃ/   tongue too far back / too rounded
#:   /s/ → /t/   the fricative stopped into a burst
#:   /θ/ → /s/   backing to the sibilant
#:   /θ/ → /f/   labiodental substitution — acoustically the hardest pair here
#:   /θ/ → /t/   stopping
#:   /ɹ/ → /w/   the dominant English pattern: rounding without the F3 drop
#:   /ɹ/ → /l/   lateral placement
#:   /l/ → /w/   the dominant lateral pattern
#:   /l/ → /ɹ/   retroflexion instead of lateral contact
CANDIDATES: dict[str, tuple[str, ...]] = {
    "s": ("s", "th", "sh", "t"),
    "th": ("th", "s", "f", "t"),
    "r": ("r", "w", "l"),
    "l": ("l", "w", "r"),
}


def spec(key: str) -> Phoneme:
    try:
        return INVENTORY[key]
    except KeyError:
        raise ValueError(f"unknown phoneme {key!r}") from None


def candidates_for(target: str) -> tuple[str, ...]:
    try:
        return CANDIDATES[target]
    except KeyError:
        raise ValueError(
            f"{target!r} is not a practice target; supported: {', '.join(TARGETS)}"
        ) from None


def family_of(target: str) -> str:
    return spec(target).family
