from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..data.prompts import PROMPTS, SOUNDS, prompt_dict

router = APIRouter(tags=["catalog"])


@router.get("/sounds")
async def sounds() -> list[dict[str, str]]:
    return SOUNDS


@router.get("/prompts")
async def prompt_for_sound(
    sound: str = Query(...), exclude: str = "", level: str = "word"
) -> dict[str, object]:
    excluded = set(filter(None, exclude.split(",")))
    options = [p for p in PROMPTS if p.target_sound == sound and p.level == level and p.id not in excluded]
    if not options:
        options = [p for p in PROMPTS if p.target_sound == sound and p.level == level]
    if not options:
        raise HTTPException(status_code=404, detail="No prompt exists for that sound.")
    return prompt_dict(options[0])


@router.get("/prompts/{prompt_id}")
async def prompt_by_id(prompt_id: str) -> dict[str, object]:
    for prompt in PROMPTS:
        if prompt.id == prompt_id:
            return prompt_dict(prompt)
    raise HTTPException(status_code=404, detail="Prompt not found.")