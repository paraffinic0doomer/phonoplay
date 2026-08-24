"""
Formant tracking.

Formants are the whole game for /r/ and /l/ — everything that distinguishes
English /ɹ/ from /w/ lives in F2 and F3 — so this uses Praat's Burg tracker
through parselmouth rather than a hand-rolled estimator. Praat's
implementation is the one the phonetics literature is written against, which
matters because the reference profiles quote figures from that literature.

A pure-numpy LPC fallback is kept for environments where the parselmouth
wheel is unavailable. It is genuinely less accurate — no formant continuity
tracking, so it will occasionally swap F2 and F3 across a transition — and
callers are told which one produced the numbers, because a measurement whose
provenance is unknown should not be scored as though it were certain.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import (
    FORMANT_CEILING_HZ,
    FORMANT_COUNT,
    FORMANT_TIME_STEP,
    SAMPLE_RATE,
    WIN_LENGTH,
)

try:  # pragma: no cover - import-time capability check
    import parselmouth

    _PARSELMOUTH = True
except Exception:  # pragma: no cover
    parselmouth = None  # type: ignore[assignment]
    _PARSELMOUTH = False


@dataclass(frozen=True)
class FormantTrack:
    """F1-F3 in Hz on the shared frame grid. NaN where undefined."""

    f1: np.ndarray
    f2: np.ndarray
    f3: np.ndarray
    #: Which estimator produced these. Reported in the response so a reader
    #: can tell a Praat measurement from a fallback one.
    method: str

    @property
    def available(self) -> bool:
        return bool(np.any(np.isfinite(self.f3)))

    def at(self, index: int) -> tuple[float, float, float]:
        return (
            float(self.f1[index]),
            float(self.f2[index]),
            float(self.f3[index]),
        )

    def median_over(self, mask: np.ndarray) -> tuple[float, float, float]:
        """Median formants over a boolean frame mask; NaN where nothing valid."""

        def med(values: np.ndarray) -> float:
            selected = values[mask]
            selected = selected[np.isfinite(selected)]
            return float(np.median(selected)) if selected.size else float("nan")

        return med(self.f1), med(self.f2), med(self.f3)


def track(samples: np.ndarray, times: np.ndarray) -> FormantTrack:
    """Estimate F1-F3 at each of `times` (seconds)."""
    if _PARSELMOUTH:
        try:
            return _praat(samples, times)
        except Exception:  # pragma: no cover - fall through to LPC
            pass
    return _lpc(samples, times)


def _praat(samples: np.ndarray, times: np.ndarray) -> FormantTrack:
    sound = parselmouth.Sound(  # type: ignore[union-attr]
        np.asarray(samples, dtype=np.float64), sampling_frequency=SAMPLE_RATE
    )
    formant = sound.to_formant_burg(
        time_step=FORMANT_TIME_STEP,
        max_number_of_formants=FORMANT_COUNT,
        maximum_formant=FORMANT_CEILING_HZ,
        window_length=0.025,
        pre_emphasis_from=50.0,
    )

    out = np.full((3, len(times)), np.nan, dtype=np.float32)
    for i, t in enumerate(times):
        for n in (1, 2, 3):
            value = formant.get_value_at_time(n, float(t))
            if value is not None and np.isfinite(value):
                out[n - 1, i] = value

    return FormantTrack(f1=out[0], f2=out[1], f3=out[2], method="praat-burg")


def _lpc(samples: np.ndarray, times: np.ndarray) -> FormantTrack:
    """
    Autocorrelation LPC, roots to formants. The fallback path.

    Order 2 + sr/1000 is the standard rule of thumb: two poles per expected
    formant across the band, plus two for the overall spectral tilt.
    """
    import librosa

    order = 2 + SAMPLE_RATE // 1000
    window = np.hamming(WIN_LENGTH).astype(np.float32)
    half = WIN_LENGTH // 2
    padded = np.pad(np.asarray(samples, dtype=np.float32), half, mode="constant")

    out = np.full((3, len(times)), np.nan, dtype=np.float32)

    for i, t in enumerate(times):
        centre = int(round(float(t) * SAMPLE_RATE)) + half
        chunk = padded[centre - half : centre + half]
        if chunk.size < WIN_LENGTH or float(np.max(np.abs(chunk))) < 1e-6:
            continue

        # Pre-emphasis flattens the -6 dB/octave source tilt so the LPC fit
        # spends its poles on the vocal tract rather than on the glottis.
        emphasised = np.append(chunk[0], chunk[1:] - 0.97 * chunk[:-1]) * window

        try:
            coefficients = librosa.lpc(emphasised.astype(np.float64), order=order)
        except Exception:
            continue

        roots = np.roots(coefficients)
        roots = roots[np.imag(roots) > 0]
        if roots.size == 0:
            continue

        freqs = np.angle(roots) * (SAMPLE_RATE / (2 * np.pi))
        # -0.5 * (sr/2pi) * ln|r| is the standard pole-radius-to-bandwidth
        # conversion; wide poles are spectral tilt, not formants.
        bandwidths = -0.5 * (SAMPLE_RATE / (2 * np.pi)) * np.log(np.abs(roots))

        keep = (freqs > 90) & (freqs < FORMANT_CEILING_HZ) & (bandwidths < 400)
        picked = np.sort(freqs[keep])
        for n in range(min(3, picked.size)):
            out[n, i] = picked[n]

    return FormantTrack(f1=out[0], f2=out[1], f3=out[2], method="lpc-fallback")
