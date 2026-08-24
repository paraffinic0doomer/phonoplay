"""
The Sound Journey endpoints.

    GET  /api/journey/languages                     languages a learner can pick
    GET  /api/journey/stages                        the seven stages, five bands
    GET  /api/journey/{learner}/profile             the learner's first language
    PUT  /api/journey/{learner}/profile             set it
    GET  /api/journey/{learner}                     every sound's progress
    GET  /api/journey/{learner}/{sound}             one journey in detail
    POST /api/journey/{learner}/{sound}/material    generate the next exercise
    POST /api/journey/{learner}/{sound}/attempt     record and assess an attempt

Route order matters: the literal paths are declared before `/{learner_id}`
and `/{learner_id}/{sound}`, or a learner called "stages" would shadow them.

The learner's first language reaches the material generator and the bridge
shown in the UI. It never reaches `assess()` — see `app/languages.py` for why
that separation is both a stability property and the only honest option.

The attempt endpoint is where the two halves meet, and the order of
operations inside it is the design:

    measure the audio  ->  classify the outcome  ->  apply the policy  ->  persist

The measurement comes from `app/acoustic/`. The policy is a pure function of
past outcomes. The language model that wrote the exercise is not consulted
and its output is not passed along. There is no path by which generated text
can influence whether a learner advances.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..acoustic import TARGETS
from ..config import Settings, get_settings
from ..languages import (
    DEFAULT_TARGET,
    as_dict as bridge_dict,
    bridge_for,
    language_dict,
    native_options,
    target_options,
)
from ..journey import material as material_module
from ..journey import policy, stages
from ..journey.store import JourneyStore, get_store
from ..schemas import PronunciationResponse
from .pronunciation import assess

log = logging.getLogger(__name__)

router = APIRouter(prefix="/journey", tags=["journey"])

#: Journeys are per learner per sound, so a learner id is required. It is an
#: opaque browser-generated string, not an account. Bounded so a malformed
#: client cannot write unbounded keys into the database.
MAX_LEARNER_ID = 64


def store_dependency() -> JourneyStore:
    return get_store()


def _check_learner(learner_id: str) -> None:
    if not learner_id or len(learner_id) > MAX_LEARNER_ID:
        raise HTTPException(status_code=422, detail="Invalid learner id.")


def _check(learner_id: str, sound: str) -> None:
    _check_learner(learner_id)
    if sound not in TARGETS:
        raise HTTPException(
            status_code=404,
            detail=f"{sound!r} is not a practice sound. Available: {', '.join(TARGETS)}.",
        )


def _language_view(store: JourneyStore, learner_id: str, sound: str | None = None) -> dict:
    """
    The learner's language context.

    `target` is always English. Bangla can be a first language here but not a
    target one, because the acoustic reference data is English only — the
    registry says so and this block reports it rather than leaving the UI to
    infer it.
    """
    native = store.native_language(learner_id)
    view = {
        "native": language_dict(native),
        "target": language_dict(DEFAULT_TARGET),
        "cross_language": native != DEFAULT_TARGET,
    }
    if sound is not None:
        view["bridge"] = bridge_dict(bridge_for(native, sound))
    return view


def _journey_view(store: JourneyStore, learner_id: str, sound: str) -> dict:
    journey = store.get(learner_id, sound)
    return {
        "learner_id": learner_id,
        "sound": sound,
        "language": _language_view(store, learner_id, sound),
        "stage": stages.as_dict(journey.stage),
        "bands": stages.band_map(),
        "started_at": journey.started_at,
        "updated_at": journey.updated_at,
        "counts": store.counts(learner_id, sound),
        "stage_outcomes": store.outcomes_at_stage(learner_id, sound, journey.stage),
    }


@router.get("/languages", summary="Languages a learner can choose")
async def languages() -> dict:
    """
    Static. `target` lists only what PhonoPlay can actually measure, which is
    English; `native` lists what practice can be personalized for.
    """
    return {
        "native": [language_dict(lang.code) for lang in native_options()],
        "target": [language_dict(lang.code) for lang in target_options()],
        "default_native": DEFAULT_TARGET,
        "note": (
            "PhonoPlay can personalize practice for learners whose first "
            "language differs from their target language."
        ),
    }


@router.get("/stages", summary="The stage and band definitions")
async def stage_definitions() -> dict:
    """Static. The UI renders the journey from this rather than hard-coding it."""
    return {
        "stages": [stages.as_dict(s.index) for s in stages.STAGES],
        "bands": stages.band_map(),
    }


class ProfileUpdate(BaseModel):
    native_language: str


@router.get("/{learner_id}/profile", summary="The learner's language choice")
async def get_profile(
    learner_id: str,
    store: Annotated[JourneyStore, Depends(store_dependency)],
) -> dict:
    _check_learner(learner_id)
    return {"learner_id": learner_id, "language": _language_view(store, learner_id)}


@router.put("/{learner_id}/profile", summary="Set the learner's first language")
async def set_profile(
    learner_id: str,
    update: ProfileUpdate,
    store: Annotated[JourneyStore, Depends(store_dependency)],
) -> dict:
    _check_learner(learner_id)
    # Unknown codes normalise to the default rather than 422: a stale client
    # sending a language we have since removed should fall back to English,
    # not lose access to the app.
    resolved = store.set_native_language(learner_id, update.native_language)
    return {
        "learner_id": learner_id,
        "language": _language_view(store, learner_id),
        "applied": resolved,
        "requested": update.native_language,
    }


@router.get("/{learner_id}", summary="Every sound's progress for one learner")
async def learner_overview(
    learner_id: str,
    store: Annotated[JourneyStore, Depends(store_dependency)],
) -> dict:
    _check_learner(learner_id)

    # Every target is listed, including untouched ones, so the UI has a
    # complete picture without needing to know the sound list itself.
    existing = {journey.sound: journey for journey in store.all_for(learner_id)}
    return {
        "learner_id": learner_id,
        "language": _language_view(store, learner_id),
        "bands": stages.band_map(),
        "journeys": [
            {
                "sound": sound,
                "stage": stages.as_dict(
                    existing[sound].stage if sound in existing else stages.FIRST_STAGE
                ),
                "started": sound in existing,
                "updated_at": existing[sound].updated_at if sound in existing else None,
                "counts": store.counts(learner_id, sound) if sound in existing else {},
            }
            for sound in TARGETS
        ],
    }


@router.get("/{learner_id}/{sound}", summary="One journey, with recent history")
async def journey_detail(
    learner_id: str,
    sound: str,
    store: Annotated[JourneyStore, Depends(store_dependency)],
) -> dict:
    _check(learner_id, sound)
    view = _journey_view(store, learner_id, sound)
    view["history"] = [record.__dict__ for record in store.history(learner_id, sound)]
    return view


class MaterialRequest(BaseModel):
    #: Text the learner has just practised, so a "hold with different
    #: material" decision can hand back something new.
    avoid: str | None = None


@router.post("/{learner_id}/{sound}/material", summary="Generate the next exercise")
async def next_material(
    learner_id: str,
    sound: str,
    settings: Annotated[Settings, Depends(get_settings)],
    store: Annotated[JourneyStore, Depends(store_dependency)],
    request: MaterialRequest | None = None,
) -> dict:
    _check(learner_id, sound)
    journey = store.get(learner_id, sound)

    generated = await material_module.generate(
        sound,
        journey.stage,
        settings,
        avoid=(request.avoid if request else None),
        native=store.native_language(learner_id),
    )
    return {
        "material": generated.model_dump(),
        "stage": stages.as_dict(journey.stage),
        "language": _language_view(store, learner_id, sound),
    }


class AttemptResult(BaseModel):
    """
    What one attempt produced.

    `analysis` and `decision` are separate fields on purpose. The analysis is
    the measurement; the decision is what the progression did about it. A
    reader can check the second follows from the first.
    """

    analysis: PronunciationResponse
    outcome: str
    decision: dict
    journey: dict
    attempt_id: int


@router.post("/{learner_id}/{sound}/attempt", summary="Assess and record an attempt")
async def record_attempt(
    learner_id: str,
    sound: str,
    audio: Annotated[UploadFile, File(description="The recording, any browser format.")],
    settings: Annotated[Settings, Depends(get_settings)],
    store: Annotated[JourneyStore, Depends(store_dependency)],
    #: The text the learner was asked to say. Labelling only — no part of the
    #: measurement depends on it.
    prompt_text: Annotated[str | None, Form()] = None,
) -> AttemptResult:
    _check(learner_id, sound)
    journey = store.get(learner_id, sound)

    # 1. Measure. Raises AudioError for unusable audio, handled in main.py.
    analysis = await assess(
        await audio.read(), sound, settings, expected_text=prompt_text, position="onset"
    )

    # 2. Classify — from the measurement, and nothing else.
    outcome = policy.outcome_of(
        assessed=analysis.assessed,
        estimated_match=analysis.estimated_match,
        target=sound,
        similarity=analysis.similarity_score,
    )

    # 3. Decide, from this stage's history plus the attempt just made.
    history = store.outcomes_at_stage(learner_id, sound, journey.stage)
    decision = policy.decide(journey.stage, [*history, outcome])

    # 4. Persist, then move. Recording first means an attempt is never lost
    # to a failure between the two writes, and the attempt row keeps the
    # stage it was actually made at.
    attempt_id = store.record(
        learner_id, sound, journey.stage,
        outcome=outcome,
        similarity=analysis.similarity_score,
        confidence=analysis.confidence,
        estimated_match=analysis.estimated_match,
        feedback_code=analysis.feedback_code,
        prompt_text=prompt_text,
        decision=decision.action,
    )
    if decision.moved:
        store.set_stage(learner_id, sound, decision.to_stage)

    log.info(
        "journey learner=%s sound=%s stage=%d -> %s (%s) => %s",
        learner_id, sound, journey.stage, outcome, analysis.feedback_code, decision.action,
    )

    return AttemptResult(
        analysis=analysis,
        outcome=outcome,
        decision={
            "action": decision.action,
            "from_stage": decision.from_stage,
            "to_stage": decision.to_stage,
            "reason": decision.reason,
            "vary_material": decision.vary_material,
            "show_hint": decision.show_hint,
            # The hint comes from the acoustic feedback, so it is about what
            # was measured rather than generic encouragement.
            "hint": analysis.hint if decision.show_hint else None,
        },
        journey=_journey_view(store, learner_id, sound),
        attempt_id=attempt_id,
    )
