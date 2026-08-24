"""
Reference profiles: what each phoneme is expected to measure like.

The profiles are data, not code. `reference/profiles.json` is produced by
`scripts/build_reference_profiles.py` from a synthesised corpus measured
through this same analysis path, and every value in it carries the token
count it came from. Nothing here invents a number, and nothing here is
tunable at runtime — swapping in a better reference set is a matter of
rebuilding that file.

The comparison model is a diagonal-covariance Gaussian per phoneme: each
feature is summarised by a centre and a spread, and features are treated as
independent. They are not fully independent — `f3_hz` and `f3_ratio` are
computed from the same measurement — and that is why the correlated pairs
carry deliberately low weights. Stating the approximation is better than
pretending to a full covariance estimate that 274 synthetic tokens cannot
support.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

REFERENCE_PATH = Path(__file__).parent / "reference" / "profiles.json"


@dataclass(frozen=True)
class FeatureReference:
    """One feature's expected centre, spread, and importance."""

    name: str
    mean: float
    #: Never the raw measured spread — see `measured_sd`. Floored at an
    #: estimate of real between-speaker variation so the model cannot be more
    #: confident than the reference data justifies.
    sd: float
    #: The spread actually observed in the corpus, kept for transparency.
    measured_sd: float
    weight: float
    n: int


@dataclass(frozen=True)
class PhonemeProfile:
    key: str
    ipa: str
    family: str
    tokens: int
    features: dict[str, FeatureReference]


@dataclass(frozen=True)
class ReferenceSet:
    version: int
    built: str
    provenance: dict
    profiles: dict[str, PhonemeProfile]

    def profile(self, key: str) -> PhonemeProfile:
        try:
            return self.profiles[key]
        except KeyError:
            raise ProfileError(f"no reference profile for {key!r}") from None

    def has(self, key: str) -> bool:
        return key in self.profiles


class ProfileError(RuntimeError):
    """The reference set is missing or unusable."""


@lru_cache(maxsize=1)
def load(path: Path | None = None) -> ReferenceSet:
    """Load and validate the reference set. Cached for the process lifetime."""
    source = path or REFERENCE_PATH
    if not source.exists():
        raise ProfileError(
            f"reference profiles not found at {source}. "
            "Run scripts/build_reference_profiles.py."
        )

    document = json.loads(source.read_text(encoding="utf-8"))
    profiles: dict[str, PhonemeProfile] = {}

    for key, entry in document.get("profiles", {}).items():
        features = {
            name: FeatureReference(
                name=name,
                mean=float(spec["mean"]),
                sd=float(spec["sd"]),
                measured_sd=float(spec.get("measured_sd", spec["sd"])),
                weight=float(spec["weight"]),
                n=int(spec.get("n", 0)),
            )
            for name, spec in entry.get("features", {}).items()
            # A zero or negative spread would divide by zero and, worse, would
            # claim certainty the corpus cannot support.
            if float(spec.get("sd", 0)) > 0
        }
        if not features:
            continue
        profiles[key] = PhonemeProfile(
            key=key,
            ipa=entry.get("ipa", key),
            family=entry["family"],
            tokens=int(entry.get("tokens", 0)),
            features=features,
        )

    if not profiles:
        raise ProfileError(f"{source} contains no usable profiles")

    return ReferenceSet(
        version=int(document.get("version", 0)),
        built=str(document.get("built", "unknown")),
        provenance=document.get("provenance", {}),
        profiles=profiles,
    )
