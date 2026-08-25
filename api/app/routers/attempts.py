"""
POST /api/attempts — the combined attempt record the original UI contract asks
for (ARCHITECTURE.md §4).

This is a presentation layer over the acoustic stage: it takes the same
measurement `/api/pronunciation` returns and reshapes it into `AttemptResult`,
the object the results screen was built against. It adds no analysis of its
own, and every number in the response traces back to `app/acoustic/`.

The transcript block is present but empty. Transcription is a separate stage
with its own endpoint; joining the two here would recreate exactly the
conflation the two-stage design exists to prevent. A caller that wants both
signals asks for both and keeps them apart, as the practice screen does.
"""

from __future__ import annotations

import time
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..acoustic.feedback import ON_TARGET, TARGET_IMPRECISE, UNABLE_TO_ASSESS
from ..config import Settings, get_settings
from ..data.prompts import PROMPTS, Prompt, prompt_dict
from ..schemas import PronunciationResponse
from .pronunciation import assess

router = APIRouter(tags=["attempts"])

#: In-memory, and deliberately so: these feed the results screen for the
#: length of a session. Durable learner progress lives in the journey store,
#: which is the thing designed to be come back to.
SESSION_ATTEMPTS: dict[str, list[dict[str, object]]] = {}
ATTEMPT_RESULTS: dict[str, dict[str, object]] = {}

#: How many attempt records to keep per session before dropping the oldest.
#: Unbounded dicts in a long-lived process are a leak.
MAX_PER_SESSION = 200

_IPA = {"s": "s", "r": "ɹ", "l": "l", "th": "θ"}


def position_of(prompt: Prompt) -> str:
    """
    Where the target sits in the word, from the prompt bank's own phoneme
    list. Read from the data, never guessed from the recording.
    """
    if not prompt.target_indices:
        return "onset"
    index = prompt.target_indices[0]
    if index == 0:
        return "onset"
    if index == len(prompt.phonemes) - 1:
        return "coda"
    return "medial"


def _deviation(analysis: PronunciationResponse, target_ipa: str) -> dict[str, object]:
    """Map the acoustic verdict onto the UI's deviation vocabulary."""
    if not analysis.assessed or analysis.estimated_match is None:
        return {
            "type": "inconclusive",
            "label": None,
            "from": target_ipa,
            "to": None,
            "confidence": analysis.confidence,
            "evidence": ["audio_quality", "segment_salience"],
            "explanation": analysis.message,
        }

    on_target = analysis.feedback_code in (ON_TARGET,)
    imprecise = analysis.feedback_code == TARGET_IMPRECISE
    return {
        "type": "none" if on_target else "distortion" if imprecise else "substitution",
        "label": None if on_target else analysis.feedback_code,
        "from": target_ipa,
        "to": analysis.estimated_match_ipa,
        "confidence": analysis.confidence,
        "evidence": ["spectral_features", "reference_profile", "segment_salience"],
        "explanation": analysis.message,
    }


@router.post("/attempts")
async def create_attempt(
    audio: Annotated[UploadFile, File()],
    prompt_id: Annotated[str, Form()],
    session_id: Annotated[str, Form()],
    settings: Annotated[Settings, Depends(get_settings)],
    client_mime_type: Annotated[str | None, Form()] = None,
    client_duration_s: Annotated[float | None, Form()] = None,
    client_sample_rate: Annotated[int | None, Form()] = None,
    client_channels: Annotated[int | None, Form()] = None,
    client_size_bytes: Annotated[int | None, Form()] = None,
) -> dict[str, object]:
    prompt = next((item for item in PROMPTS if item.id == prompt_id), None)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found.")

    started = time.perf_counter()
    analysis = await assess(
        await audio.read(),
        prompt.target_sound,
        settings,
        expected_text=prompt.text,
        position=position_of(prompt),
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    target_ipa = _IPA[prompt.target_sound]
    quality = analysis.quality
    # The UI works in 0-100. The underlying similarity is a probability-shaped
    # number in (0, 1]; scaling is presentation, and nothing downstream of the
    # scale change treats it as a different measurement.
    target_score = round(analysis.similarity_score * 100, 1)

    attempt_id = str(uuid4())
    response: dict[str, object] = {
        "attempt_id": attempt_id,
        "prompt": prompt_dict(prompt) | {"target_ipa": target_ipa},
        "audio_quality": {
            "ok": quality.ok,
            "duration_s": quality.duration_s,
            "snr_db": quality.snr_db,
            "clipped": quality.clipped_fraction > 0.05,
            "warnings": list(quality.warnings),
            "source": {
                "mime_type": client_mime_type,
                "duration_s": client_duration_s,
                "sample_rate": client_sample_rate,
                "channels": client_channels,
                "size_bytes": client_size_bytes,
            },
        },
        # Stage 1 is a separate endpoint. Left empty rather than faked.
        "transcript": {
            "text": "",
            "asr_confidence": 0.0,
            "word_match": False,
            "normalized_edit_distance": 1.0,
        },
        "target_analysis": {
            "target_phoneme": target_ipa,
            "occurrences": (
                []
                if analysis.segment is None
                else [
                    {
                        "index": prompt.target_indices[0] if prompt.target_indices else 0,
                        "start_s": analysis.segment.start_s,
                        "end_s": analysis.segment.end_s,
                        "gop": None,
                        "gop_normalized": analysis.similarity_score,
                        "observed_top": [
                            {"phoneme": c.ipa, "prob": c.posterior}
                            for c in analysis.candidates[:3]
                        ],
                        "verdict": (
                            "unclear"
                            if not analysis.assessed
                            else "on_target"
                            if analysis.feedback_code == ON_TARGET
                            else "distortion"
                            if analysis.feedback_code == TARGET_IMPRECISE
                            else "substitution"
                        ),
                    }
                ]
            ),
        },
        "phoneme_timeline": [],
        "acoustic_features": analysis.acoustic_features,
        "deviation": _deviation(analysis, target_ipa),
        # Whether a phoneme was actually named. A caller must branch on this
        # before rendering `scores` as a result: the numbers below are a real
        # measurement of similarity to the target profile, but when this is
        # false the stage declined to say what was produced, and a bare
        # percentage presented as a verdict would invent the certainty the
        # analysis explicitly withheld.
        "assessed": analysis.assessed,
        "scores": {
            "overall": target_score,
            "target_sound": target_score,
            # Word accuracy is a transcription measure and this endpoint does
            # not transcribe. Reported as null rather than as a zero that
            # would read like a failed measurement.
            "word_accuracy": None,
            "confidence": analysis.confidence,
        },
        "timings_ms": {
            "ingest": 0,
            "asr": 0,
            "acoustic": analysis.processing_ms,
            "total": elapsed_ms,
        },
    }

    # Unassessable attempts are kept out of the progress series. Plotting a
    # zero for a recording we declined to score would show a learner getting
    # worse because a door slammed.
    if analysis.feedback_code != UNABLE_TO_ASSESS and analysis.assessed:
        points = SESSION_ATTEMPTS.setdefault(session_id, [])
        points.append(
            {
                "sound": prompt.target_sound,
                "score": target_score,
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        del points[:-MAX_PER_SESSION]

    ATTEMPT_RESULTS[attempt_id] = response
    if len(ATTEMPT_RESULTS) > MAX_PER_SESSION * 5:
        for stale in list(ATTEMPT_RESULTS)[: len(ATTEMPT_RESULTS) - MAX_PER_SESSION * 5]:
            ATTEMPT_RESULTS.pop(stale, None)

    return response
