"""
The sentences PhonoPlay promises to say, and the facts behind them.

Every user-facing safety string lives here rather than at its call site. Not
for tidiness: these are commitments about what the product claims and what it
refuses to claim, and a commitment that exists in four slightly different
wordings across three files is one nobody can check. Here they can be
asserted exactly, and `tests/test_safety_language.py` and
`tests/test_privacy.py` do assert them.

## What PhonoPlay is

An educational pronunciation practice tool. It measures how one recording of
one sound compares against a small reference set and suggests what to try
next. It is not a diagnostic instrument, and nothing it produces is evidence
about a person's speech, language, hearing, or development.

## Where audio actually goes

Worth stating precisely, because "we don't store your audio" is easy to say
and often not the whole truth:

  * **The pronunciation measurement is local.** `app/acoustic/` runs on this
    server. Audio for stage 2 never leaves it.
  * **Transcription is not.** `POST /api/analyze` sends the recording to
    Groq, a third party, for speech-to-text. That is a real transmission and
    it is disclosed rather than glossed. A deployment that must keep audio
    on-device should set `STT_PROVIDER=fake` and lose only stage 1.
  * **Nothing else receives audio.** Exercise generation sends text — the
    target sound, the stage, the language — and never a recording.

## What is written to disk

One transient file per request: `app/audio/ingest.py` spills the upload to a
temp file because ffprobe cannot seek a pipe, and removes it in `finally`.
Nothing else. The journey database has no column audio could occupy, so no
future change can begin storing recordings by accident — `tests/` asserts the
exact column set.

## What is stored about a learner

An opaque identifier the browser generates, and the outcome of each attempt.
No name, no email, no address, no phone number, no age, no date of birth, no
account. The identifier is not asked for and is not linked to anything; it
exists so that closing the tab does not erase a journey.
"""

from __future__ import annotations

#: The core disclaimer. Shown wherever a result is presented, in this exact
#: wording — a learner or a parent should meet it at the moment a number
#: appears, not only in a footer.
DISCLAIMER = (
    "PhonoPlay provides educational pronunciation feedback and is not a "
    "medical diagnosis."
)

#: Shown when confidence falls below the floor. The promise is that the
#: system says this rather than forcing a phoneme it cannot support.
UNCERTAIN = "Unable to confidently assess this attempt."

#: Shown when the analysis could not run at all — no speech, too much noise,
#: a clipped recording, no locatable target. Deliberately one sentence for
#: every such case: the specific reason follows in `detail`, but the headline
#: never varies, so a failure can never be mistaken for a poor score.
ANALYSIS_FAILED = (
    "We couldn't confidently analyze this recording. Try again in a quieter "
    "environment."
)

#: One line for the privacy summary. The longer version is in README.md.
PRIVACY_SUMMARY = (
    "Recordings are analyzed and then discarded. PhonoPlay keeps the "
    "measurements, never the audio, and never asks for your name or any "
    "other personal detail."
)

#: Where audio goes, per stage. Stated separately because the two stages have
#: genuinely different answers and collapsing them would be misleading.
AUDIO_HANDLING = [
    {
        "stage": "acoustic",
        "label": "Pronunciation analysis",
        "leaves_device": False,
        "detail": (
            "Runs on the PhonoPlay server. The recording is measured, the "
            "numbers are kept, and the audio is discarded when the request "
            "ends."
        ),
    },
    {
        "stage": "transcription",
        "label": "Speech recognition",
        "leaves_device": True,
        "detail": (
            "The recording is sent to Groq, a third-party speech-to-text "
            "service, to work out which words were said. This is the only "
            "step that sends audio anywhere."
        ),
    },
    {
        "stage": "material",
        "label": "Practice material",
        "leaves_device": False,
        "detail": (
            "The exercise generator receives text only — the target sound, "
            "the stage, and the language being practised. It never receives "
            "a recording or a score."
        ),
    },
]

#: The four steps behind a result, in order. Rendered by the UI's "How
#: PhonoPlay works" section; kept here so the explanation and the pipeline
#: cannot drift apart.
HOW_IT_WORKS = [
    {
        "step": 1,
        "title": "Audio is analyzed",
        "detail": (
            "Your recording is measured for loudness, noise, and where the "
            "target sound sits in it. If it cannot support a result, "
            "PhonoPlay stops here and says so."
        ),
    },
    {
        "step": 2,
        "title": "Speech recognition provides linguistic context",
        "detail": (
            "A speech-to-text model reports which words it recognised. This "
            "is context, not a pronunciation score — it corrects "
            "mispronunciations toward real words, so it cannot tell you how "
            "a sound was produced."
        ),
    },
    {
        "step": 3,
        "title": "Acoustic features help estimate pronunciation similarity",
        "detail": (
            "Measurements from the recording — where the sound's energy "
            "sits, how loud and how long it is, where the tongue shaped it — "
            "are compared against reference recordings. The result is a "
            "similarity estimate, not a verdict."
        ),
    },
    {
        "step": 4,
        "title": "AI generates practice material",
        "detail": (
            "A language model writes the next exercise. It never sees your "
            "recording and never decides how you did — that comes from the "
            "measurement alone."
        ),
    },
]

#: Stated plainly so the UI can render it without paraphrasing.
NOT_CLAIMED = [
    "PhonoPlay does not diagnose, assess, or treat any speech, language, "
    "hearing, or developmental condition.",
    "It cannot tell a pronunciation pattern apart from an accent, a regional "
    "variant, a head cold, or a poor microphone.",
    "Its reference recordings are two synthesised adult voices, so it is "
    "least reliable for the children it is designed to help.",
    "A result is about one recording of one sound. It is not evidence about "
    "a person.",
]


def public_notice() -> dict:
    """Everything the UI needs to explain itself, in one payload."""
    return {
        "disclaimer": DISCLAIMER,
        "uncertain": UNCERTAIN,
        "analysis_failed": ANALYSIS_FAILED,
        "privacy_summary": PRIVACY_SUMMARY,
        "audio_handling": AUDIO_HANDLING,
        "how_it_works": HOW_IT_WORKS,
        "not_claimed": NOT_CLAIMED,
    }
