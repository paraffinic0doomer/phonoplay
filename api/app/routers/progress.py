from __future__ import annotations

from fastapi import APIRouter

from ..routers.attempts import SESSION_ATTEMPTS

router = APIRouter(tags=["progress"])


@router.get("/sessions/{session_id}/progress")
async def session_progress(session_id: str) -> dict[str, object]:
    by_sound: dict[str, list[dict[str, object]]] = {}
    for attempt in SESSION_ATTEMPTS.get(session_id, []):
        sound = str(attempt["sound"])
        points = by_sound.setdefault(sound, [])
        points.append({"attempt_n": len(points) + 1, "score": attempt["score"], "ts": attempt["ts"]})
    deltas = {
        sound: round(points[-1]["score"] - points[0]["score"], 1)
        for sound, points in by_sound.items()
        if len(points) > 1
    }
    return {"by_sound": by_sound, "deltas": deltas}