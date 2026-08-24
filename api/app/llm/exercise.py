from __future__ import annotations

import json
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..config import Settings


class ExerciseItem(BaseModel):
    text: str = Field(min_length=1, max_length=40)
    contrast: str | None = Field(default=None, max_length=40)
    target_ipa: str = Field(min_length=1, max_length=4)
    prompt_id: str | None = None


class Exercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    explanation: str = Field(min_length=1, max_length=240)
    words: list[ExerciseItem] = Field(min_length=3, max_length=3)
    phrase: str = Field(min_length=1, max_length=120)
    challenge: str = Field(min_length=1, max_length=160)
    difficulty: str = Field(min_length=1, max_length=40)
    encouragement: str = Field(min_length=1, max_length=160)


FALLBACKS = {
    "s": Exercise(explanation="Keep a narrow stream of air behind your top teeth.", words=[ExerciseItem(text="sun", target_ipa="s", prompt_id="s_word_sun"), ExerciseItem(text="sock", target_ipa="s", prompt_id="s_word_sock"), ExerciseItem(text="sing", target_ipa="s", prompt_id=None)], phrase="Sam sees six silver socks.", challenge="Say each word slowly, then repeat the phrase while keeping the /s/ stream steady.", difficulty="simple_words", encouragement="Your careful airflow is the skill to keep building."),
    "r": Exercise(explanation="Pull the tongue back and keep the lips relaxed for /r/.", words=[ExerciseItem(text="rabbit", target_ipa="ɹ", prompt_id="r_word_rabbit"), ExerciseItem(text="red", target_ipa="ɹ", prompt_id="r_word_red"), ExerciseItem(text="ring", target_ipa="ɹ", prompt_id=None)], phrase="The red rabbit runs.", challenge="Alternate slow and natural speed without rounding your lips.", difficulty="simple_words", encouragement="A steady tongue shape makes /r/ clearer."),
    "l": Exercise(explanation="Touch the ridge behind your top teeth and let air flow around the tongue.", words=[ExerciseItem(text="lion", target_ipa="l", prompt_id="l_word_lion"), ExerciseItem(text="leaf", target_ipa="l", prompt_id="l_word_leaf"), ExerciseItem(text="light", target_ipa="l", prompt_id=None)], phrase="Lily likes lemon leaves.", challenge="Hold the tongue contact briefly at the start of each word.", difficulty="simple_words", encouragement="Keep that clear tongue-tip contact."),
    "th": Exercise(explanation="Place the tongue lightly between the teeth and use gentle airflow.", words=[ExerciseItem(text="thumb", target_ipa="θ", prompt_id="th_word_thumb"), ExerciseItem(text="think", target_ipa="θ", prompt_id="th_word_think"), ExerciseItem(text="three", target_ipa="θ", prompt_id=None)], phrase="Three thin threads.", challenge="Whisper the phrase first, then repeat it with a gentle voiced-to-unvoiced contrast.", difficulty="simple_words", encouragement="Gentle airflow is more useful here than force."),
}


def fallback(target: str, attempt_id: str = "fallback") -> dict[str, Any]:
    exercise = FALLBACKS[target]
    return {"id": f"fallback-ex-{attempt_id}", "attempt_id": attempt_id, "target_sound": target, "deviation_label": None, "title": f"Practise /{exercise.words[0].target_ipa}/", "cue": exercise.explanation, "activity_type": "isolation", "items": [item.model_dump() for item in exercise.words], "difficulty": 1, "source": "fallback", "content": exercise.model_dump()}


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip().removeprefix("```json").removesuffix("```").strip()
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("generator returned a non-object")
    return value


async def generate(attempt: dict[str, Any], settings: Settings) -> dict[str, Any]:
    target = str(attempt.get("target_sound", ""))
    if target not in FALLBACKS:
        raise ValueError("unsupported target sound")
    attempt_id = str(attempt.get("attempt_id", "unknown"))
    base = fallback(target, attempt_id)
    keys = settings.groq_api_key_pool
    if not keys:
        return base
    evidence = {key: attempt.get(key) for key in ("target_sound", "estimated_match", "similarity_score", "confidence", "mastery", "difficulty")}
    prompt = f"Generate concise educational practice for {target}. Evidence is authoritative but do not score or diagnose. Return JSON only with explanation, words (exactly 3 objects with text,target_ipa,prompt_id,contrast), phrase, challenge, difficulty, encouragement. Use real English words containing the target sound. Never mention disorders or diagnosis. Evidence: {json.dumps(evidence)}"
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            for key in keys:
                try:
                    response = await client.post(
                        f"{settings.groq_base_url.rstrip('/')}/chat/completions",
                        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                        json={"model": settings.groq_model, "temperature": 0.2, "max_tokens": 350, "response_format": {"type": "json_object"}, "messages": [{"role": "system", "content": "You create short pronunciation practice. The acoustic system owns scores. Never provide medical claims."}, {"role": "user", "content": prompt}]},
                    )
                    response.raise_for_status()
                    body = response.json()
                    content = body["choices"][0]["message"]["content"]
                    generated = Exercise.model_validate(_extract_json(content))
                    base.update({"content": generated.model_dump(), "items": [item.model_dump() for item in generated.words], "cue": generated.explanation, "source": "llm"})
                    return base
                except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
                    continue
        return base
    except Exception:
        return base