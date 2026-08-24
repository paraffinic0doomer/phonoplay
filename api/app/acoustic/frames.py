"""
Frame-level primitives, computed once per attempt and shared.

Segmentation, the quality gate, and feature extraction all need the same
short-time views of the signal. Computing them once and passing a `FrameSet`
around keeps them consistent — a segment boundary found on one framing grid
and measured on another is a subtle, silent source of error — and keeps a
whole analysis inside a few tens of milliseconds on CPU.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import HOP_LENGTH, N_FFT, SAMPLE_RATE, WIN_LENGTH

#: Voicing needs a longer window than the spectral features: at a 70 Hz f0 a
#: 25 ms window holds under two periods, which is not enough for a stable
#: autocorrelation peak. 40 ms holds nearly three.
VOICING_WIN = 640

#: Plausible speaking f0 range, from a low adult male to a young child.
F0_MIN_HZ = 70.0
F0_MAX_HZ = 450.0

#: Normalised autocorrelation above this counts the frame as voiced. 0.35 is
#: deliberately permissive: approximants such as /ɹ/ and /l/ are voiced but
#: less periodic than vowels, and missing them would be worse than
#: occasionally admitting a periodic noise frame.
VOICED_THRESHOLD = 0.35


@dataclass(frozen=True)
class FrameSet:
    """Aligned per-frame measurements. Every array has the same length."""

    times: np.ndarray
    #: Linear magnitude spectrogram, [n_bins, n_frames].
    magnitude: np.ndarray
    #: Bin centre frequencies in Hz, [n_bins].
    freqs: np.ndarray
    rms: np.ndarray
    db: np.ndarray
    zcr: np.ndarray
    #: Normalised autocorrelation peak in [0, 1] — how periodic the frame is.
    voicing: np.ndarray
    #: f0 in Hz where the frame is voiced, else NaN.
    f0: np.ndarray

    @property
    def n(self) -> int:
        return len(self.times)

    @property
    def voiced(self) -> np.ndarray:
        return self.voicing >= VOICED_THRESHOLD

    def index_at(self, time_s: float) -> int:
        return int(np.clip(round(time_s * SAMPLE_RATE / HOP_LENGTH), 0, max(self.n - 1, 0)))

    def window(self, start_s: float, end_s: float) -> slice:
        """Frame indices covering [start_s, end_s). Always at least one frame."""
        a = self.index_at(start_s)
        b = max(a + 1, self.index_at(end_s))
        return slice(a, min(b, self.n))


def _center_frame(y: np.ndarray, win: int, hop: int, n_frames: int) -> np.ndarray:
    """Frames matching librosa's `center=True` layout, as [win, n_frames]."""
    padded = np.pad(y, win // 2, mode="constant")
    out = np.empty((win, n_frames), dtype=np.float32)
    for i in range(n_frames):
        start = i * hop
        chunk = padded[start : start + win]
        if chunk.size < win:
            chunk = np.pad(chunk, (0, win - chunk.size), mode="constant")
        out[:, i] = chunk
    return out


def _voicing(y: np.ndarray, n_frames: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Per-frame periodicity and f0 by normalised autocorrelation.

    Chosen over a full pitch tracker (YIN/pYIN) for two reasons: we need a
    *continuous* voicing strength rather than a binary decision — the
    segmenter weights frames by it — and this runs in a few milliseconds
    where pYIN's HMM decoding runs in hundreds.
    """
    frames = _center_frame(y, VOICING_WIN, HOP_LENGTH, n_frames)
    window = np.hanning(VOICING_WIN).astype(np.float32)[:, None]
    windowed = frames * window
    windowed = windowed - windowed.mean(axis=0, keepdims=True)

    # Autocorrelation via the Wiener-Khinchin theorem. Zero-padding to 2N
    # keeps it linear rather than circular.
    spectrum = np.fft.rfft(windowed, n=2 * VOICING_WIN, axis=0)
    autocorr = np.fft.irfft(np.abs(spectrum) ** 2, axis=0)[:VOICING_WIN]

    energy = autocorr[0]
    safe = np.where(energy > 1e-12, energy, 1.0)
    normalized = autocorr / safe

    lag_min = max(1, int(SAMPLE_RATE / F0_MAX_HZ))
    lag_max = min(VOICING_WIN - 1, int(SAMPLE_RATE / F0_MIN_HZ))

    band = normalized[lag_min : lag_max + 1]
    if band.size == 0:
        return np.zeros(n_frames, np.float32), np.full(n_frames, np.nan, np.float32)

    best = np.argmax(band, axis=0)
    strength = band[best, np.arange(n_frames)]
    # A frame with no energy has no periodicity, whatever the ratio says.
    strength = np.where(energy > 1e-12, strength, 0.0)
    strength = np.clip(strength, 0.0, 1.0).astype(np.float32)

    lags = (best + lag_min).astype(np.float32)
    f0 = np.where(strength >= VOICED_THRESHOLD, SAMPLE_RATE / lags, np.nan)

    return strength, f0.astype(np.float32)


def analyse(samples: np.ndarray) -> FrameSet:
    """Compute every shared frame-level view of the signal."""
    import librosa

    y = np.ascontiguousarray(samples, dtype=np.float32)
    n_frames = 1 + len(y) // HOP_LENGTH

    magnitude = np.abs(
        librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH, win_length=WIN_LENGTH, center=True)
    )
    magnitude = magnitude[:, :n_frames]
    if magnitude.shape[1] < n_frames:  # pragma: no cover - short-clip guard
        pad = n_frames - magnitude.shape[1]
        magnitude = np.pad(magnitude, ((0, 0), (0, pad)))

    freqs = librosa.fft_frequencies(sr=SAMPLE_RATE, n_fft=N_FFT)

    rms = librosa.feature.rms(
        y=y, frame_length=WIN_LENGTH, hop_length=HOP_LENGTH, center=True
    )[0][:n_frames]
    zcr = librosa.feature.zero_crossing_rate(
        y=y, frame_length=WIN_LENGTH, hop_length=HOP_LENGTH, center=True
    )[0][:n_frames]

    voicing, f0 = _voicing(y, n_frames)

    return FrameSet(
        times=np.arange(n_frames, dtype=np.float32) * (HOP_LENGTH / SAMPLE_RATE),
        magnitude=magnitude,
        freqs=freqs,
        rms=rms.astype(np.float32),
        db=(20.0 * np.log10(np.maximum(rms, 1e-10))).astype(np.float32),
        zcr=zcr.astype(np.float32),
        voicing=voicing,
        f0=f0,
    )
