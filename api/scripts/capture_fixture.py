"""
One-off: call Groq with a fixture clip and save the raw verbose_json.

The saved file becomes the input for the normalization unit tests, so those
tests assert against a response the provider genuinely produced rather than
one written from the docs. Re-run only when the provider's shape changes.

    python scripts/capture_fixture.py tests/fixtures/speech_sun.wav
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.audio import ingest  # noqa: E402
from app.config import get_settings  # noqa: E402


async def main() -> int:
    source = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/speech_sun.wav")
    settings = get_settings()
    if not settings.groq_api_key:
        print("GROQ_API_KEY is not set")
        return 1

    normalized = await ingest.normalize(source.read_bytes(), settings)
    print(
        f"{source.name}: {len(source.read_bytes())} bytes "
        f"-> {len(normalized.data)} bytes wav, {normalized.duration_s:.2f}s "
        f"@ {normalized.sample_rate} Hz mono"
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.groq_base_url}/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            data={
                "model": settings.groq_model,
                "response_format": "verbose_json",
                "timestamp_granularities[]": ["word", "segment"],
                "temperature": "0",
                "language": "en",
            },
            files={"file": (normalized.filename, normalized.data, normalized.mime_type)},
        )

    print(f"HTTP {response.status_code}")
    rate_headers = {
        key: value
        for key, value in response.headers.items()
        if key.lower().startswith(("x-ratelimit", "retry-after"))
    }
    if rate_headers:
        print("rate-limit headers:", json.dumps(rate_headers, indent=2))

    if response.status_code != 200:
        print(response.text[:800])
        return 1

    body = response.json()
    out = ROOT / "tests" / "fixtures" / "groq_verbose_json.json"
    out.write_text(json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"saved {out.relative_to(ROOT)}")
    print("transcript:", json.dumps(body.get("text")))
    print("language:", body.get("language"), "| duration:", body.get("duration"))
    print("segments:", len(body.get("segments") or []), "| words:", len(body.get("words") or []))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
