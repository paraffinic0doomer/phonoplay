"""
Measure the reference corpus and write app/acoustic/reference/profiles.json.

Run `scripts/build_reference_corpus.ps1` first to synthesise the audio, then:

    .venv/Scripts/python.exe scripts/build_reference_profiles.py

Every number in profiles.json comes out of this script. None is typed in by
hand, and none is copied from a wideband textbook table — the corpus is
measured at 16 kHz through the same `preprocess -> frames -> segment ->
features` path that scores a learner's recording, so the profile means are
directly comparable to what the learner will be scored against. Reusing the
scoring path is the point: a reference measured a different way would encode
the difference between the two paths as if it were a pronunciation error.

Three things this script does that are judgement calls, all deliberate:

  1. **Median and MAD, not mean and SD.** A handful of the 288 tokens will be
     mis-segmented (a stop burst caught instead of the fricative, a formant
     tracker excursion). Robust statistics keep those from moving the
     profile; a plain mean would let one bad token shift a reference by
     several hundred Hz.

  2. **Standard deviations are floored.** Two synthetic voices reading at
     three rates produce a corpus far tighter than real speakers are. Taking
     the measured spread at face value would make the model wildly
     overconfident — every genuine human recording would look like an
     outlier. Each floor below is a stated estimate of real between-speaker
     variation for that feature.

  3. **Features measured on fewer than MIN_TOKENS tokens are dropped.** A
     reference computed from four measurements is not a reference.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.acoustic import features as feat  # noqa: E402
from app.acoustic import formants as fm  # noqa: E402
from app.acoustic import frames as fr  # noqa: E402
from app.acoustic import preprocess, segment  # noqa: E402
from app.acoustic.phonemes import APPROXIMANT, FRICATIVE, INVENTORY  # noqa: E402

CORPUS = Path(__file__).resolve().parents[1] / "reference_corpus"
OUT = Path(__file__).resolve().parents[1] / "app" / "acoustic" / "reference" / "profiles.json"

#: A feature needs at least this many clean measurements to enter a profile.
MIN_TOKENS = 8

#: Minimum standard deviation per feature, in the feature's own units.
#: These are estimates of real between-speaker variation, not measurements of
#: the corpus — see note 2 in the module docstring. Where a published range
#: exists the floor is set to roughly a quarter of it, so that ±2 SD spans
#: the range rather than a fraction of it.
SD_FLOOR = {
    # Spectral position varies with vocal-tract length and, for fricatives,
    # with how much of the /s/ plateau sits above our 8 kHz ceiling.
    "centroid_hz": 700.0,
    "peak_hz": 900.0,
    "rolloff85_hz": 800.0,
    "bandwidth_hz": 400.0,
    "flatness": 0.06,
    "tilt_db_per_khz": 1.5,
    "hf_ratio": 0.10,
    "zcr": 0.05,
    "voicing": 0.12,
    # Effort and vowel context both move this; 4 dB is conservative against
    # the ~15 dB sibilant/non-sibilant gap it is there to detect.
    "rel_intensity_db": 4.0,
    "duration_s": 0.035,
    # Absolute formants span roughly 1 kHz across adult and child speakers.
    "f1_hz": 120.0,
    "f2_hz": 250.0,
    "f3_hz": 280.0,
    "f3_minus_f2_hz": 250.0,
    # Speaker-normalised (both divided by the speaker's median F3), so the
    # floor is a fraction rather than a frequency.
    "f2_over_speaker_f3": 0.05,
    "f3_over_speaker_f3": 0.07,
    "release_flux": 0.06,
    "f2_slope_hz_per_s": 2500.0,
    "mid_dip_db": 3.0,
}

#: How much each feature counts in the comparison, per family. Weights are
#: stated here and copied into profiles.json so the scoring rules stay
#: readable without opening the code.
#:
#: `f2_hz`/`f3_hz` carry low weight on purpose: they are correlated with the
#: `*_ratio` features computed from them, and a diagonal-covariance model
#: cannot see that correlation. Keeping the raw values in at low weight means
#: a recording with no usable speaker reference still gets a formant signal,
#: without letting the pair vote twice at full strength when both are present.
WEIGHTS = {
    FRICATIVE: {
        "rel_intensity_db": 1.2,
        "centroid_hz": 1.0,
        "hf_ratio": 1.0,
        "peak_hz": 0.8,
        "tilt_db_per_khz": 0.8,
        "flatness": 0.6,
        "rolloff85_hz": 0.6,
        "bandwidth_hz": 0.5,
        "zcr": 0.5,
        "duration_s": 0.5,
        "voicing": 0.4,
    },
    APPROXIMANT: {
        "f3_over_speaker_f3": 1.4,
        "f3_minus_f2_hz": 1.2,
        "f2_over_speaker_f3": 1.0,
        "release_flux": 0.9,
        "mid_dip_db": 0.8,
        "f2_slope_hz_per_s": 0.6,
        "f3_hz": 0.5,
        "f2_hz": 0.4,
        "f1_hz": 0.4,
        "duration_s": 0.3,
    },
}


def measure(path: Path, phoneme: str) -> dict[str, float] | None:
    """Run one reference file through the learner-facing analysis path."""
    signal = preprocess.prepare(path.read_bytes())
    frames = fr.analyse(signal.samples)
    formants = fm.track(signal.samples, frames.times)

    located = segment.locate(phoneme, signal, frames, formants, position=segment.ONSET)
    if located is None or located.salience <= 0.0:
        return None

    return feat.extract(phoneme, signal, frames, formants, located).values


def robust_sd(values: np.ndarray) -> float:
    """
    Median absolute deviation, scaled to a standard deviation.

    1.4826 is the constant that makes MAD a consistent estimator of sigma for
    normally distributed data.
    """
    return float(1.4826 * np.median(np.abs(values - np.median(values))))


def main() -> int:
    if not CORPUS.exists():
        print(f"No corpus at {CORPUS}. Run scripts/build_reference_corpus.ps1 first.")
        return 1

    profiles: dict[str, dict] = {}
    provenance_tokens = 0

    for phoneme, spec in INVENTORY.items():
        folder = CORPUS / phoneme
        files = sorted(folder.glob("*.wav")) if folder.exists() else []
        if not files:
            print(f"  {phoneme:>3}: no audio, skipped")
            continue

        collected: dict[str, list[float]] = defaultdict(list)
        located = 0
        for path in files:
            values = measure(path, phoneme)
            if values is None:
                continue
            located += 1
            for name, value in values.items():
                if np.isfinite(value):
                    collected[name].append(float(value))

        provenance_tokens += located

        entries: dict[str, dict[str, float]] = {}
        weights = WEIGHTS[spec.family]
        for name, weight in weights.items():
            samples = np.asarray(collected.get(name, []), dtype=float)
            if samples.size < MIN_TOKENS:
                continue
            measured_sd = robust_sd(samples)
            floor = SD_FLOOR.get(name, abs(float(np.median(samples))) * 0.15 or 1.0)
            entries[name] = {
                "mean": round(float(np.median(samples)), 4),
                "sd": round(float(max(measured_sd, floor)), 4),
                "measured_sd": round(measured_sd, 4),
                "weight": weight,
                "n": int(samples.size),
            }

        profiles[phoneme] = {
            "ipa": spec.ipa,
            "family": spec.family,
            "tokens": located,
            "features": entries,
        }
        print(f"  {phoneme:>3}: {located}/{len(files)} located, {len(entries)} features")

    document = {
        "version": 1,
        "built": date.today().isoformat(),
        "sample_rate": 16000,
        "provenance": {
            "method": "synthesised reference corpus, measured through the "
            "production analysis path",
            "source": "Windows SAPI (System.Speech) text-to-speech",
            "voices": ["Microsoft David Desktop", "Microsoft Zira Desktop"],
            "rates": [-2, 0, 2],
            "position": "word-initial",
            "tokens": provenance_tokens,
            "statistics": "median for the centre, MAD-derived sd floored at "
            "an estimate of real between-speaker variation",
            "limitations": "app/acoustic/reference/README.md",
        },
        "profiles": profiles,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {OUT} ({provenance_tokens} tokens)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
