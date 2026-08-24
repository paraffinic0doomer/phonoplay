import asyncio

from app.config import Settings
from app.llm.exercise import Exercise, _extract_json, fallback, generate


def test_fallback_is_valid_for_all_supported_targets():
    for target in ("s", "r", "l", "th"):
        result = fallback(target, "attempt-1")
        assert Exercise.model_validate(result["content"]).words
        assert len(result["items"]) == 3
        assert result["source"] == "fallback"


def test_malformed_json_is_rejected():
    try:
        _extract_json("not json")
    except ValueError:
        pass
    else:
        raise AssertionError("malformed generator output was accepted")


def test_generation_falls_back_without_a_key():
    result = asyncio.run(generate({"target_sound": "th", "attempt_id": "a"}, Settings(groq_api_keys="", groq_keys_file="missing-groq-keys.txt")))
    assert result["source"] == "fallback"
    assert len(result["items"]) == 3