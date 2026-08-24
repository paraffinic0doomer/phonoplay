"""
The Adaptive Sound Journey.

A per-sound progression from the target sound in isolation to the same sound
in natural speech, where the learner's position is decided by measurement
rather than by counting attempts.

The separation that matters runs through every module here:

    material.py   a language model writes the exercise
    policy.py     the acoustic measurement decides whether it was passed

Nothing a language model produces reaches `policy.decide()`, and nothing in
`policy.py` performs I/O — the whole progression is a pure function of past
outcomes, which is what makes it testable end to end.

    stages.py   the seven stages and the five visible bands
    policy.py   advance / retreat / hold / hint
    store.py    SQLite persistence, so a journey survives closing the tab
    material.py Groq generation with a deterministic fallback bank
"""

from .material import Material, StageMaterial, generate
from .policy import ADVANCE, HINT, HOLD, RETREAT, Decision, decide, outcome_of
from .stages import BANDS, FIRST_STAGE, LAST_STAGE, STAGES, band_map, stage
from .store import JourneyStore, get_store, set_store

__all__ = [
    "ADVANCE",
    "BANDS",
    "FIRST_STAGE",
    "HINT",
    "HOLD",
    "LAST_STAGE",
    "RETREAT",
    "STAGES",
    "Decision",
    "JourneyStore",
    "Material",
    "StageMaterial",
    "band_map",
    "decide",
    "generate",
    "get_store",
    "outcome_of",
    "set_store",
    "stage",
]
