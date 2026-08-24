"""
Turning a measurement into something a learner can act on.

Two rules govern everything in this module.

**Describe sounds, never speakers.** PhonoPlay is a pronunciation practice
tool. It reports what the audio measured and what to try next. It does not
name conditions, does not diagnose, and does not imply that a pronunciation
pattern is a disorder — that is a judgement only a qualified
speech-language professional can make, from far more evidence than a
two-second recording. The vocabulary here is deliberately restricted to
"target-sound mismatch", "pronunciation pattern", and "acoustic deviation".
Words like lisp, rhotacism, and disorder appear nowhere in learner-facing
copy, and a test asserts that.

**Never claim more than was measured.** Every code below maps to a specific
state of the analysis, including the states where the answer is "we could not
tell". `UNABLE_TO_ASSESS` is a normal outcome, not an error path.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..safety import ANALYSIS_FAILED, UNCERTAIN
from .phonemes import spec

#: The recording measured like the target sound.
ON_TARGET = "ON_TARGET"
#: Recognisably the target, with room to sharpen it.
CLOSE_TO_TARGET = "CLOSE_TO_TARGET"
#: The target sound, but produced imprecisely — the right place, blurred.
TARGET_IMPRECISE = "TARGET_IMPRECISE"
#: A different sound from the candidate set measured as the better match.
#: Emitted as SUBSTITUTION_<TARGET>_<MATCH>, e.g. SUBSTITUTION_S_TH.
SUBSTITUTION_PREFIX = "SUBSTITUTION"
#: The evidence did not support naming a sound.
UNABLE_TO_ASSESS = "UNABLE_TO_ASSESS"
#: No speech in the recording at all.
NO_SPEECH_DETECTED = "NO_SPEECH_DETECTED"
#: Speech, but no landmark for this target anywhere in it.
TARGET_NOT_LOCATED = "TARGET_NOT_LOCATED"
AUDIO_TOO_NOISY = "AUDIO_TOO_NOISY"
AUDIO_CLIPPED = "AUDIO_CLIPPED"
AUDIO_TOO_SHORT = "AUDIO_TOO_SHORT"

#: The message shown whenever confidence falls below the floor, and the one
#: shown when the analysis could not run at all. Both are fixed wordings the
#: product promises; they live in `app/safety.py` and are re-exported here so
#: call sites read naturally.
UNCERTAIN_MESSAGE = UNCERTAIN
ANALYSIS_FAILED_MESSAGE = ANALYSIS_FAILED


@dataclass(frozen=True)
class Feedback:
    code: str
    #: One sentence describing what the recording measured like. On any
    #: failure this is the fixed `ANALYSIS_FAILED_MESSAGE`, never a variant —
    #: a headline that changes with the reason invites reading a failure as a
    #: poor result.
    message: str
    #: The specific reason, when there is one. Shown under the headline, so
    #: nothing is lost by keeping the headline constant.
    detail: str | None = None
    #: What to physically try next. None when there is nothing to act on yet.
    cue: str | None = None
    #: Shown before a retry when confidence was low, per the journey rules.
    hint: str | None = None


#: Articulation cues per (target, what was measured instead). Standard
#: placement descriptions — where the tongue goes, what the airflow does.
_SUBSTITUTION_CUES: dict[tuple[str, str], str] = {
    ("s", "th"): "The air is escaping between your tongue and teeth. Pull the "
    "tongue tip back behind your top teeth and let the air hiss down a narrow "
    "groove.",
    ("s", "sh"): "The tongue is sitting a little too far back. Slide the tip "
    "forward toward the ridge behind your top teeth and spread your lips.",
    ("s", "t"): "The air is being stopped instead of flowing. Keep the hiss "
    "going — hold it for two seconds without letting the tongue touch.",
    ("th", "s"): "The tongue is behind the teeth instead of between them. Let "
    "the tip peek out just past your top teeth and blow gently.",
    ("th", "f"): "The sound is being made with the lip instead of the tongue. "
    "Keep your bottom lip away from your teeth and put the tongue tip forward.",
    ("th", "t"): "The airflow is stopping. Let it keep flowing softly over the "
    "tongue tip instead of tapping.",
    ("r", "w"): "The lips are doing the work the tongue should do. Keep the "
    "lips relaxed and bunch the back of your tongue up and back.",
    ("r", "l"): "The tongue tip is touching the ridge. Let it hover instead — "
    "nothing should make contact for /r/.",
    ("l", "w"): "The tongue tip is not reaching the ridge. Touch it firmly "
    "behind your top teeth and let the sound flow around the sides.",
    ("l", "r"): "The tongue is curling back. Bring the tip forward until it "
    "touches the ridge behind your top teeth.",
}

#: Shown before a retry when the system could not tell. Practical, and about
#: the recording rather than the speaker.
_RETRY_HINTS: dict[str, str] = {
    "s": "Try again a little louder, and hold the hiss for a full second.",
    "th": "Try again in a quiet spot — /th/ is a soft sound and background "
    "noise covers it easily. Let it last a moment longer than feels natural.",
    "r": "Try again with the word said slowly, holding the /r/ before the "
    "vowel.",
    "l": "Try again slowly, resting on the /l/ for a moment before the vowel.",
}

_IMPRECISE_CUES: dict[str, str] = {
    "s": "The placement is right — narrow the groove in your tongue a little "
    "and push a steadier stream of air through it.",
    "th": "The placement is right — keep the tongue tip steady between your "
    "teeth and let the air flow evenly.",
    "r": "The shape is right — hold it a moment longer and let the tongue "
    "settle before moving into the vowel.",
    "l": "The contact is right — press the tongue tip a little more firmly and "
    "hold it before the vowel.",
}


def substitution_code(target: str, observed: str) -> str:
    return f"{SUBSTITUTION_PREFIX}_{target.upper()}_{observed.upper()}"


def for_blocked(code: str) -> Feedback:
    """
    Feedback for a recording that never reached scoring.

    The headline is the same sentence every time. The reason varies and is
    carried in `detail`, but a failure must never read as a low score, and a
    headline that changes with the cause is exactly how that confusion
    starts — "That recording is too short to measure" sits close enough to a
    verdict to be mistaken for one.
    """
    details = {
        NO_SPEECH_DETECTED: "No speech was detected in that recording.",
        AUDIO_TOO_NOISY: "There is too much background noise to measure this "
        "sound reliably.",
        AUDIO_CLIPPED: "That recording is too loud and the sound is distorted.",
        AUDIO_TOO_SHORT: "That recording is too short to measure.",
        TARGET_NOT_LOCATED: "The target sound could not be located in that "
        "recording.",
    }
    cues = {
        NO_SPEECH_DETECTED: "Check the microphone, then say the word once, "
        "clearly.",
        AUDIO_TOO_NOISY: "Move somewhere quieter, or hold the microphone "
        "closer, and try again.",
        AUDIO_CLIPPED: "Move back from the microphone a little and say it "
        "again at a normal volume.",
        AUDIO_TOO_SHORT: "Say the whole word, then stop the recording.",
        TARGET_NOT_LOCATED: "Say the word on its own, a little more slowly.",
    }
    return Feedback(
        code=code,
        message=ANALYSIS_FAILED_MESSAGE,
        detail=details.get(code),
        cue=cues.get(code),
    )


def for_uncertain(target: str, reason: str | None) -> Feedback:
    """Feedback when the analysis ran but the evidence was not decisive."""
    return Feedback(
        code=UNABLE_TO_ASSESS,
        # The promised sentence, plus the specific reason. The reason never
        # softens the refusal into a partial verdict.
        message=UNCERTAIN_MESSAGE,
        cue=_RETRY_HINTS.get(target),
        hint=_RETRY_HINTS.get(target),
    )


def for_verdict(target: str, observed: str, similarity: float) -> Feedback:
    """Feedback when a phoneme was confidently identified."""
    from .scoring import CLOSE_SIMILARITY, ON_TARGET_SIMILARITY

    target_spec = spec(target)

    if observed == target:
        if similarity >= ON_TARGET_SIMILARITY:
            return Feedback(
                code=ON_TARGET,
                message=f"That measured like {target_spec.label}.",
                cue=None,
            )
        if similarity >= CLOSE_SIMILARITY:
            return Feedback(
                code=CLOSE_TO_TARGET,
                message=f"That was recognisably {target_spec.label}, with room "
                "to sharpen it.",
                cue=_IMPRECISE_CUES.get(target),
            )
        # Right sound, measurably imprecise production. Named as a distortion
        # of the target rather than as a different sound, because the
        # classifier still put the target first.
        return Feedback(
            code=TARGET_IMPRECISE,
            message=f"That was closest to {target_spec.label}, but the "
            "measurement is some way from a clear production of it.",
            cue=_IMPRECISE_CUES.get(target),
        )

    observed_spec = spec(observed)
    return Feedback(
        code=substitution_code(target, observed),
        message=f"That measured closer to {observed_spec.label} than to "
        f"{target_spec.label}.",
        cue=_SUBSTITUTION_CUES.get((target, observed)),
    )
