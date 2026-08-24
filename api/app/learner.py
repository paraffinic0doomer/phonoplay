"""Target-sound learning state derived from acoustic attempt scores.

This is an educational progression heuristic, not a medical assessment. The
thresholds are intentionally documented product defaults and should be tuned
against learner outcomes rather than presented as universal standards.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean, pstdev
from typing import Iterable


# Prototype bands: they map the next practice task to the learner's recent
# acoustic performance, not to a diagnosis or a claim about ability.
DIFFICULTY_BANDS = (
    (60, "isolated_sound"),
    (75, "simple_words"),
    (85, "multisyllabic_words"),
    (92, "short_phrases"),
    (101, "sentences_speed_variation"),
)


@dataclass(frozen=True)
class LearnerState:
    phoneme: str
    mastery: float
    confidence: float
    attempt_count: int
    recent_scores: tuple[float, ...]
    trend: str
    recommended_difficulty: str
    common_feedback_codes: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "phoneme": self.phoneme,
            "mastery": self.mastery,
            "confidence": self.confidence,
            "attempt_count": self.attempt_count,
            "recent_scores": list(self.recent_scores),
            "trend": self.trend,
            "recommended_difficulty": self.recommended_difficulty,
            "common_feedback_codes": list(self.common_feedback_codes),
        }


def trend(scores: Iterable[float]) -> str:
    values = list(scores)
    if len(values) < 2:
        return "stable"
    if pstdev(values) >= 12:
        return "inconsistent"
    slope = (values[-1] - values[0]) / (len(values) - 1)
    if slope >= 2.5:
        return "improving"
    if slope <= -2.5:
        return "declining"
    return "stable"


def recommended_difficulty(mastery: float) -> str:
    for ceiling, level in DIFFICULTY_BANDS:
        if mastery < ceiling:
            return level
    return DIFFICULTY_BANDS[-1][1]


def build_state(
    phoneme: str,
    scores: Iterable[float],
    feedback_codes: Iterable[str] = (),
    *,
    recent_limit: int = 5,
) -> LearnerState:
    """Build state from acoustic similarity scores, newest score last."""
    all_scores = [float(max(0, min(100, score))) for score in scores]
    recent = all_scores[-recent_limit:]
    mastery = round(mean(recent), 1) if recent else 0.0
    # More attempts and tighter recent spread increase certainty, but never
    # allow a small sample to look fully certain.
    sample_factor = min(1.0, len(recent) / 5)
    consistency = 1.0 if len(recent) < 2 else max(0.0, 1.0 - pstdev(recent) / 25)
    confidence = round(sample_factor * consistency, 2)
    codes = list(feedback_codes)
    common = tuple(code for code, _ in sorted(
        ((code, codes.count(code)) for code in set(codes)),
        key=lambda item: (-item[1], item[0]),
    )[:3])
    return LearnerState(
        phoneme=phoneme,
        mastery=mastery,
        confidence=confidence,
        attempt_count=len(all_scores),
        recent_scores=tuple(round(score, 1) for score in recent),
        trend=trend(recent),
        recommended_difficulty=recommended_difficulty(mastery),
        common_feedback_codes=common,
    )