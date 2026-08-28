"""
POST /api/exercises — practice generated from measured evidence.

The learner model lives in the browser (CLAUDE.md — local persistence, no
accounts), so the evidence arrives in the request rather than being looked up
here. That keeps the endpoint stateless and means the generator sees exactly
what the learner model holds, not a server-side approximation of it.

`attempt_id` is still accepted for the older Practice → Results flow, which
records into an in-memory store on this process. When it is given and the
evidence is not, the evidence is filled in from that record.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from ..config import get_settings
from ..llm.exercise import ExerciseEvidence, generate
from .attempts import ATTEMPT_RESULTS

router = APIRouter(tags=["exercises"])


class ExerciseRequest(BaseModel):
    """Either full evidence, or an attempt id to derive it from."""

    model_config = ConfigDict(extra="forbid")

    evidence: ExerciseEvidence | None = None
    attempt_id: str | None = None


def _from_attempt(attempt_id: str) -> ExerciseEvidence:
    """Build evidence from an attempt this process recorded."""
    attempt = ATTEMPT_RESULTS.get(attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found.")

    prompt = attempt["prompt"]
    scores = attempt["scores"]
    similarity = scores.get("target_sound")
    return ExerciseEvidence(
        target_phoneme=prompt["target_sound"],
        # `scores` is 0-100 on this endpoint; the generator works in 0-1.
        mastery=None if similarity is None else max(0.0, min(1.0, similarity / 100)),
        confidence=scores.get("confidence"),
        recent_scores=[] if similarity is None else [max(0.0, min(1.0, similarity / 100))],
        current_stage="word",
        learning_mode="standard",
        exercise_type="production",
    )


@router.post("/exercises", summary="Generate practice from pronunciation evidence")
async def create_exercise(request: ExerciseRequest) -> dict[str, Any]:
    if request.evidence is not None:
        evidence = request.evidence
        attempt_id = request.attempt_id or "evidence"
    elif request.attempt_id:
        evidence = _from_attempt(request.attempt_id)
        attempt_id = request.attempt_id
    else:
        raise HTTPException(
            status_code=422,
            detail="Provide either evidence or an attempt_id.",
        )

    result = await generate(evidence, get_settings(), attempt_id)

    # The older flow expects the content flattened onto the response.
    content = result.pop("content")
    result.update(content)
    return result
