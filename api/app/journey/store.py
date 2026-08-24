"""
Journey persistence.

Plain `sqlite3` from the standard library. An ORM would add a dependency and
a migration story to four columns and two tables, and the schema below is the
whole data model — there is nothing here an ORM would make clearer.

What is stored is deliberately small: where each learner is in each sound's
journey, and the outcome of each attempt. **No audio is written to disk**, at
any point, and neither are transcripts. The recording exists for the length
of the request that carried it and is then gone; what survives is the
measurement it produced.

`learner_id` is an opaque identifier the browser generates and keeps in local
storage. It is not an account, carries no personal data, and is never asked
for — it exists so that closing the tab does not erase a journey.
"""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..languages import DEFAULT_NATIVE, normalise_native
from .stages import FIRST_STAGE

SCHEMA = """
-- A learner's language choice. Separate from `journeys` because it is a
-- property of the person, not of one sound's progress: choosing Bangla as a
-- first language applies across every sound at once.
CREATE TABLE IF NOT EXISTS learners (
    learner_id       TEXT PRIMARY KEY,
    native_language  TEXT NOT NULL DEFAULT 'en',
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journeys (
    learner_id  TEXT NOT NULL,
    sound       TEXT NOT NULL,
    stage       INTEGER NOT NULL,
    started_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (learner_id, sound)
);

CREATE TABLE IF NOT EXISTS attempts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    learner_id       TEXT NOT NULL,
    sound            TEXT NOT NULL,
    stage            INTEGER NOT NULL,
    outcome          TEXT NOT NULL,
    similarity       REAL,
    confidence       REAL,
    estimated_match  TEXT,
    feedback_code    TEXT,
    prompt_text      TEXT,
    decision         TEXT,
    created_at       TEXT NOT NULL
);

-- Every read is "the recent attempts for this learner at this sound", so the
-- index matches that shape exactly.
CREATE INDEX IF NOT EXISTS attempts_by_journey
    ON attempts (learner_id, sound, id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class Journey:
    learner_id: str
    sound: str
    stage: int
    started_at: str
    updated_at: str


@dataclass(frozen=True)
class AttemptRecord:
    id: int
    stage: int
    outcome: str
    similarity: float | None
    confidence: float | None
    estimated_match: str | None
    feedback_code: str | None
    prompt_text: str | None
    decision: str | None
    created_at: str


class JourneyStore:
    """
    A SQLite-backed journey store.

    One connection, guarded by a lock. FastAPI runs request handlers
    concurrently and `sqlite3` connections are not safe to share across
    threads without one; a connection pool would be the answer at a scale
    this application does not have.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        if str(path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        # WAL lets reads proceed during a write, which matters because an
        # attempt write happens while the UI is polling the journey.
        if str(path) != ":memory:":
            self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ── Learner profile ──────────────────────────────────────────────

    def native_language(self, learner_id: str) -> str:
        """
        The learner's first language, defaulting to English.

        A learner who has never chosen gets `DEFAULT_NATIVE`, which is what
        keeps English-only mode the zero-configuration path: nothing has to be
        set for the product to work.
        """
        with self._lock:
            row = self._db.execute(
                "SELECT native_language FROM learners WHERE learner_id = ?",
                (learner_id,),
            ).fetchone()
        return normalise_native(row["native_language"]) if row else DEFAULT_NATIVE

    def set_native_language(self, learner_id: str, code: str) -> str:
        """Set it, normalising unknown input rather than storing it."""
        resolved = normalise_native(code)
        with self._lock:
            self._db.execute(
                "INSERT INTO learners (learner_id, native_language, updated_at)"
                " VALUES (?, ?, ?)"
                " ON CONFLICT(learner_id) DO UPDATE SET"
                " native_language = excluded.native_language,"
                " updated_at = excluded.updated_at",
                (learner_id, resolved, _now()),
            )
            self._db.commit()
        return resolved

    # ── Journeys ─────────────────────────────────────────────────────

    def get(self, learner_id: str, sound: str) -> Journey:
        """The learner's journey for a sound, creating it at stage 1 if new."""
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM journeys WHERE learner_id = ? AND sound = ?",
                (learner_id, sound),
            ).fetchone()
            if row is None:
                now = _now()
                self._db.execute(
                    "INSERT INTO journeys (learner_id, sound, stage, started_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (learner_id, sound, FIRST_STAGE, now, now),
                )
                self._db.commit()
                return Journey(learner_id, sound, FIRST_STAGE, now, now)
        return Journey(
            row["learner_id"], row["sound"], row["stage"], row["started_at"], row["updated_at"]
        )

    def set_stage(self, learner_id: str, sound: str, stage: int) -> None:
        self.get(learner_id, sound)  # ensure the row exists
        with self._lock:
            self._db.execute(
                "UPDATE journeys SET stage = ?, updated_at = ?"
                " WHERE learner_id = ? AND sound = ?",
                (int(stage), _now(), learner_id, sound),
            )
            self._db.commit()

    def all_for(self, learner_id: str) -> list[Journey]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM journeys WHERE learner_id = ? ORDER BY sound",
                (learner_id,),
            ).fetchall()
        return [
            Journey(r["learner_id"], r["sound"], r["stage"], r["started_at"], r["updated_at"])
            for r in rows
        ]

    # ── Attempts ─────────────────────────────────────────────────────

    def record(
        self,
        learner_id: str,
        sound: str,
        stage: int,
        *,
        outcome: str,
        similarity: float | None,
        confidence: float | None,
        estimated_match: str | None,
        feedback_code: str | None,
        prompt_text: str | None,
        decision: str | None,
    ) -> int:
        with self._lock:
            cursor = self._db.execute(
                "INSERT INTO attempts (learner_id, sound, stage, outcome, similarity,"
                " confidence, estimated_match, feedback_code, prompt_text, decision,"
                " created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    learner_id, sound, int(stage), outcome, similarity, confidence,
                    estimated_match, feedback_code, prompt_text, decision, _now(),
                ),
            )
            self._db.commit()
            return int(cursor.lastrowid or 0)

    def outcomes_at_stage(
        self, learner_id: str, sound: str, stage: int, limit: int = 10
    ) -> list[str]:
        """
        Outcomes at one stage, oldest first.

        Scoped to the stage on purpose: the policy asks "how is this stage
        going", and attempts from a stage the learner has since left are not
        evidence about the one they are on.
        """
        with self._lock:
            rows = self._db.execute(
                "SELECT outcome FROM attempts WHERE learner_id = ? AND sound = ?"
                " AND stage = ? ORDER BY id DESC LIMIT ?",
                (learner_id, sound, int(stage), int(limit)),
            ).fetchall()
        return [r["outcome"] for r in reversed(rows)]

    def history(self, learner_id: str, sound: str, limit: int = 20) -> list[AttemptRecord]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM attempts WHERE learner_id = ? AND sound = ?"
                " ORDER BY id DESC LIMIT ?",
                (learner_id, sound, int(limit)),
            ).fetchall()
        return [
            AttemptRecord(
                id=r["id"], stage=r["stage"], outcome=r["outcome"],
                similarity=r["similarity"], confidence=r["confidence"],
                estimated_match=r["estimated_match"], feedback_code=r["feedback_code"],
                prompt_text=r["prompt_text"], decision=r["decision"],
                created_at=r["created_at"],
            )
            for r in reversed(rows)
        ]

    def counts(self, learner_id: str, sound: str) -> dict[str, int]:
        with self._lock:
            rows = self._db.execute(
                "SELECT outcome, COUNT(*) AS n FROM attempts"
                " WHERE learner_id = ? AND sound = ? GROUP BY outcome",
                (learner_id, sound),
            ).fetchall()
        return {r["outcome"]: r["n"] for r in rows}


_store: JourneyStore | None = None


def get_store() -> JourneyStore:
    """The process-wide store. Built by the app lifespan."""
    if _store is None:  # pragma: no cover - guarded by lifespan
        raise RuntimeError("journey store not initialised")
    return _store


def set_store(store: JourneyStore | None) -> None:
    global _store
    _store = store
