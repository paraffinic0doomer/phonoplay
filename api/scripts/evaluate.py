"""
Evaluate the acoustic stage against the reference corpus.

    .venv/Scripts/python.exe scripts/evaluate.py

For each practice target, every corpus token of that target *and of its
documented substitutions* is analysed as though a learner had produced it.
That second half is the part that matters: feeding /θ/ audio while the target
is /s/ is exactly the "intentionally altered /s/" case, and a system that
cannot tell those apart is not measuring pronunciation.

**Read the accuracy figures as a sanity check, not as a benchmark.** The
profiles were built from this same corpus, so these numbers are in-sample and
optimistic by construction. What they can honestly tell us is whether the
features separate the classes at all and whether the confidence machinery
behaves — a target that cannot be recovered from its own reference audio is
broken, whatever it might do on held-out speech. Out-of-sample behaviour is
covered by the test fixtures, which are synthesised separately from words
that are not in the corpus.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.acoustic import analyze  # noqa: E402
from app.acoustic.phonemes import CANDIDATES, TARGETS  # noqa: E402

CORPUS = Path(__file__).resolve().parents[1] / "reference_corpus"


def main() -> int:
    if not CORPUS.exists():
        print(f"No corpus at {CORPUS}. Run scripts/build_reference_corpus.ps1 first.")
        return 1

    overall_correct = overall_total = 0
    #: (confidence, was the reported label right) for every scored token,
    #: used to calibrate CONFIDENCE_FLOOR below.
    calibration: list[tuple[float, bool]] = []

    for target in TARGETS:
        print(f"\n=== target /{target}/ " + "=" * 52)
        matrix: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        stats: dict[str, list[tuple[float, float]]] = defaultdict(list)

        for spoken in CANDIDATES[target]:
            for path in sorted((CORPUS / spoken).glob("*.wav")):
                result = analyze(path.read_bytes(), target)
                verdict = result.estimated_match or "uncertain"
                matrix[spoken][verdict] += 1
                stats[spoken].append((result.similarity_score, result.confidence))
                if result.assessed:
                    calibration.append((result.confidence, verdict == spoken))

        columns = list(CANDIDATES[target]) + ["uncertain"]
        header = "  spoken   n " + "".join(f"{c:>10}" for c in columns)
        print(header + "     sim   conf")
        print("  " + "-" * (len(header) + 12))

        for spoken in CANDIDATES[target]:
            row = matrix[spoken]
            n = sum(row.values())
            similarities = [s for s, _ in stats[spoken]]
            confidences = [c for _, c in stats[spoken]]
            line = f"  /{spoken:<5}/ {n:>3} " + "".join(f"{row.get(c, 0):>10}" for c in columns)
            print(
                line
                + f"   {sum(similarities) / max(n, 1):>5.2f}  {sum(confidences) / max(n, 1):>5.2f}"
            )

            # The diagonal: how often the sound that was actually spoken was
            # the one reported.
            overall_correct += row.get(spoken, 0)
            overall_total += n

    print(
        f"\nIn-sample identification: {overall_correct}/{overall_total} "
        f"({100 * overall_correct / max(overall_total, 1):.1f}%) — optimistic, see the module docstring."
    )
    # Calibration. The question a confidence floor has to answer is: among the
    # attempts we were willing to put a label on, how often was that label
    # right? Raising the floor trades coverage for precision, and the table
    # below is what that trade actually costs. CONFIDENCE_FLOOR in scoring.py
    # is set from this table, not from taste.
    print("\n  floor   assessed        precision")
    print("  " + "-" * 40)
    for floor in (0.0, 0.30, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70):
        kept = [ok for conf, ok in calibration if conf >= floor]
        if not kept:
            continue
        print(
            f"  {floor:>5.2f}   {len(kept):>4} ({100 * len(kept) / max(overall_total, 1):>4.0f}%)"
            f"      {100 * sum(kept) / len(kept):>5.1f}%"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
