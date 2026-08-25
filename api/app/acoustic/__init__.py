"""
Stage 2: acoustic pronunciation analysis.

Separate from stage 1 (transcription) in every sense that matters — separate
package, separate inputs, separate output schema, separate endpoint. Stage 1
reports which words were recognised. This stage measures how a specific sound
was produced. Neither reads the other's result.

Public surface:

    analyze(audio, target, ...) -> PronunciationAnalysis
    warmup()                    -> preload the reference set and JIT paths
"""

from .analyzer import (
    STATUS_ASSESSED,
    STATUS_UNCERTAIN,
    STATUS_UNUSABLE,
)
from .analyzer import PronunciationAnalysis, analyze, warmup
from .phonemes import TARGETS
from .preprocess import SignalError
from .segment import CODA, MEDIAL, ONSET

__all__ = [
    "CODA",
    "MEDIAL",
    "ONSET",
    "TARGETS",
    "PronunciationAnalysis",
    "SignalError",
    "analyze",
    "warmup",
]
