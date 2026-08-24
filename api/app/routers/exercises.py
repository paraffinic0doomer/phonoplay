from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import get_settings
from ..llm.exercise import generate
from .attempts import ATTEMPT_RESULTS

router = APIRouter(tags=["exercises"])


class ExerciseRequest(BaseModel):
    attempt_id: str


@router.post("/exercises")
async def create_exercise(request: ExerciseRequest) -> dict[str, Any]:
    attempt = ATTEMPT_RESULTS.get(request.attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found.")
    prompt = attempt["prompt"]
    scores = attempt["scores"]
    deviation = attempt["deviation"]
    evidence = {
        "attempt_id": request.attempt_id,
        "target_sound": prompt["target_sound"],
        "estimated_match": deviation.get("to"),
        "similarity_score": scores.get("target_sound"),
        "confidence": scores.get("confidence"),
        "mastery": scores.get("overall"),
    }
    result = await generate(evidence, get_settings())
    content = result.pop("content")
    result.update(content)
    return result