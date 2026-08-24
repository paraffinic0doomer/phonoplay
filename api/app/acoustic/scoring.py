"""
Comparison and scoring. This is where measured features become a number.

The model is a **Gaussian naive Bayes classifier over target-specific
acoustic features**, with diagonal covariance and uniform priors. Written
out, for one candidate phoneme k with reference profile P_k:

    z_ik    = (x_i - mu_ik) / sd_ik           per-feature standardised error
    e_ik    = w_i · min(z_ik², Z_MAX²)        clipped, weighted squared error

    log L_k = -½ · Σ_i e_ik                   naive-Bayes log-likelihood
    p_k     = softmax_k(log L_k)              posterior over the candidates

    sim_k   = exp(-½ · Σ_i e_ik / Σ_i w_i)    the same distance, per feature
    conf    = p_top × trust(quality, salience, coverage)

`similarity_score` is `sim` for the *target* phoneme: 1.0 means the recording
measured exactly like the reference for that sound, and it falls off as a
Gaussian in standardised distance. `estimated_match` is argmax p, chosen only
among the target and its documented substitutions.

Why this form:

  * `exp(-d²/2)` is not a curve picked to look nice — it is the Gaussian
    likelihood normalised to 1 at the reference mean. Reading a similarity of
    0.61 as "about one standard deviation off, averaged over the weighted
    features" is exactly correct.
  * The posterior uses the **sum** of weighted errors and the similarity uses
    their **mean**, and that difference is deliberate. The sum is the actual
    naive-Bayes log-likelihood, with the weights acting as feature-repetition
    counts; it is what makes the posterior sharp enough to mean something.
    The mean is a per-feature distance, which is what makes `similarity`
    comparable between /s/ (11 features) and /r/ (10) and readable as "about
    one SD off". Using the mean for both — an earlier mistake worth
    recording — divided every distance by ~8 and flattened the posteriors so
    far that a textbook /s/ came back at 0.64 confidence.
  * Clipping |z| at Z_MAX stops one wild feature — a formant tracker
    excursion, a mis-segmented frame — from driving the whole score to zero.
    Beyond four standard deviations the extra distance carries no additional
    information: the feature is simply wrong.
  * Uniform priors. We have no honest basis for saying a learner is more
    likely to produce /θ/ than /s/ before listening, and inventing a prior
    would put a thumb on the scale of the very thing being measured.

Nothing here is a threshold on a hidden model. Every input is a number
measured from the audio, and every constant below is stated with its reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .features import FeatureSet
from .phonemes import candidates_for
from .profiles import PhonemeProfile, ReferenceSet

#: Standardised errors are clipped here. Four SD is already "this feature
#: does not match"; ten SD is not ten times more informative.
Z_MAX = 4.0

#: A verdict needs at least this many features in common between the
#: recording and the profile. Below it the comparison is an accident of
#: whichever one or two features happened to survive.
MIN_FEATURES = 4

#: Below this confidence the system refuses to name a phoneme. Chosen so that
#: a clean recording with a clear landmark and a decisive margin clears it
#: comfortably, while a noisy or ambiguous one does not — the whole point
#: being that "I do not know" is a supported answer.
CONFIDENCE_FLOOR = 0.45

#: The similarity above which a match against the target counts as a solid
#: production, and below which it is the right sound produced imprecisely.
#: 0.55 is roughly one standard deviation of weighted feature error.
ON_TARGET_SIMILARITY = 0.55
CLOSE_SIMILARITY = 0.35

#: Weights for the trust term of the confidence (see `_confidence`). A
#: weighted geometric mean, so a single collapsed factor collapses the
#: result — which is the intent. Quality counts most because a bad recording
#: invalidates everything downstream of it.
TRUST_WEIGHTS = {
    "quality": 2.0,
    "salience": 1.5,
    "coverage": 1.0,
}


@dataclass(frozen=True)
class CandidateScore:
    phoneme: str
    ipa: str
    similarity: float
    posterior: float
    #: Per-feature standardised error, for display and for debugging. This is
    #: what makes the score auditable: a reader can see which measurement
    #: drove the verdict.
    z_scores: dict[str, float] = field(default_factory=dict)
    features_used: int = 0


@dataclass(frozen=True)
class ScoreResult:
    target: str
    #: None when the evidence does not support naming a phoneme.
    estimated_match: str | None
    similarity_score: float
    confidence: float
    #: Every candidate, best first. Always populated when scoring ran.
    candidates: list[CandidateScore]
    margin: float
    coverage: float
    #: Set when no verdict could be reached, explaining which factor failed.
    inconclusive_reason: str | None = None


@dataclass(frozen=True)
class Comparison:
    """One candidate measured against the recording."""

    #: exp(-½ · mean weighted squared error). Per-feature, so comparable
    #: across candidate sets of different sizes.
    similarity: float
    #: -½ · total weighted squared error. The naive-Bayes log-likelihood, up
    #: to a constant that cancels in the softmax.
    log_likelihood: float
    z_scores: dict[str, float]
    total_weight: float


def _compare(features: dict[str, float], profile: PhonemeProfile) -> Comparison:
    z_scores: dict[str, float] = {}
    weighted_error = 0.0
    total_weight = 0.0

    for name, reference in profile.features.items():
        if name not in features:
            continue
        z = (features[name] - reference.mean) / reference.sd
        z_scores[name] = round(float(z), 3)
        clipped = min(abs(z), Z_MAX)
        weighted_error += reference.weight * clipped * clipped
        total_weight += reference.weight

    if total_weight <= 0:
        return Comparison(0.0, -np.inf, z_scores, 0.0)

    return Comparison(
        similarity=float(np.exp(-0.5 * weighted_error / total_weight)),
        log_likelihood=-0.5 * weighted_error,
        z_scores=z_scores,
        total_weight=total_weight,
    )


def _softmax(log_likelihoods: list[float]) -> list[float]:
    """Posteriors from log-likelihoods, via the log-sum-exp trick."""
    values = np.asarray(log_likelihoods, dtype=float)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return [0.0] * len(log_likelihoods)
    shifted = np.exp(values - finite.max())
    shifted[~np.isfinite(values)] = 0.0
    total = shifted.sum()
    if total <= 0:  # pragma: no cover - unreachable while any candidate is finite
        return [0.0] * len(log_likelihoods)
    return [float(v) for v in shifted / total]


def _ramp(value: float, low: float, high: float) -> float:
    if high <= low:
        return 1.0
    return float(np.clip((value - low) / (high - low), 0.0, 1.0))


def _confidence(posterior: float, quality: float, salience: float, coverage: float) -> float:
    """
    How much to trust this verdict, as a probability-shaped number.

        confidence = posterior × trust
        trust      = weighted geometric mean of (quality, salience, coverage)

    The two terms answer two different questions, and multiplying them is the
    honest way to combine them: `posterior` is how sure the classifier is
    *given* the measurements, and `trust` is how much the measurements
    themselves are worth. A decisive-looking posterior computed on an
    unusable recording should not produce a confident answer, and a clean
    recording that lands between two profiles should not either.

    An earlier version folded the top-two posterior gap into a four-way
    geometric mean alongside the others. That was wrong in a way worth
    recording: a fractional exponent compresses every factor toward 1, so a
    genuinely ambiguous classification — a 0.57/0.42 split between /l/ and
    /w/ — still came out at 0.68 confidence. Capping by the posterior makes
    the classifier's own uncertainty impossible to dilute.

    Geometric rather than arithmetic within `trust` so its factors cannot
    compensate for one another either.
    """
    factors = {
        "quality": max(quality, 1e-6),
        "salience": max(salience, 1e-6),
        "coverage": max(coverage, 1e-6),
    }
    total = sum(TRUST_WEIGHTS.values())
    log_sum = sum(TRUST_WEIGHTS[name] * np.log(value) for name, value in factors.items())
    trust = float(np.exp(log_sum / total))
    return float(np.clip(posterior * trust, 0.0, 1.0))


def score(
    target: str,
    features: FeatureSet,
    reference: ReferenceSet,
    *,
    quality: float,
    salience: float,
) -> ScoreResult:
    """Compare the measured features against the target and its alternatives."""
    keys = [k for k in candidates_for(target) if reference.has(k)]
    if not keys:  # pragma: no cover - guarded by the profile loader
        raise ValueError(f"no reference profiles available for target {target!r}")

    comparisons = {key: _compare(features.values, reference.profile(key)) for key in keys}
    posteriors = _softmax([comparisons[key].log_likelihood for key in keys])

    scored = [
        CandidateScore(
            phoneme=key,
            ipa=reference.profile(key).ipa,
            similarity=round(comparisons[key].similarity, 4),
            posterior=round(posteriors[i], 4),
            z_scores=comparisons[key].z_scores,
            features_used=len(comparisons[key].z_scores),
        )
        for i, key in enumerate(keys)
    ]
    scored.sort(key=lambda c: c.posterior, reverse=True)

    target_profile = reference.profile(target)
    used = sum(1 for name in target_profile.features if name in features.values)
    coverage = used / max(len(target_profile.features), 1)

    similarity_score = next(c.similarity for c in scored if c.phoneme == target)
    margin = scored[0].posterior - (scored[1].posterior if len(scored) > 1 else 0.0)
    confidence = _confidence(scored[0].posterior, quality, salience, coverage)

    reason: str | None = None
    if used < MIN_FEATURES:
        reason = "too few features could be measured on this recording"
    elif not any(c.similarity > 0 for c in scored):
        reason = "the measured features matched none of the reference profiles"
    elif confidence < CONFIDENCE_FLOOR:
        reason = "the evidence is not strong enough to name a sound"

    return ScoreResult(
        target=target,
        estimated_match=None if reason else scored[0].phoneme,
        similarity_score=round(similarity_score, 4),
        confidence=round(confidence, 4),
        candidates=scored,
        margin=round(float(margin), 4),
        coverage=round(coverage, 3),
        inconclusive_reason=reason,
    )
