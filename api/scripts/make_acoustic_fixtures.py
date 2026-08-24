"""
Build the synthetic (non-speech) acoustic fixtures.

Run `scripts/make_acoustic_fixtures.ps1` first for the spoken ones, then:

    .venv/Scripts/python.exe scripts/make_acoustic_fixtures.py

These cover the cases where the right answer is a refusal rather than a
verdict, which are as important to test as the successes:

    noise_white.wav       broadband noise, no speech
    noise_room.wav        low-frequency rumble, no speech
    speech_in_noise.wav   real speech at ~3 dB SNR — the "uncertain" case
    clipped.wav           speech driven well past full scale

`speech_in_noise.wav` is mixed at a measured SNR rather than an arbitrary
gain, so the fixture tests a specific condition rather than "quite noisy".
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
SR = 16000
RNG = np.random.default_rng(20260824)  # fixed: fixtures must be reproducible


def write(name: str, samples: np.ndarray) -> None:
    path = FIXTURES / name
    sf.write(path, np.clip(samples, -1.0, 1.0).astype(np.float32), SR, subtype="PCM_16")
    print(f"  {name}  ({path.stat().st_size / 1024:.0f} kB)")


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x))) + 1e-12)


def mix_at_snr(speech: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    """Scale `noise` so the mixture sits at exactly `snr_db`."""
    if noise.size < speech.size:
        noise = np.tile(noise, int(np.ceil(speech.size / noise.size)))
    noise = noise[: speech.size]
    target_noise_rms = rms(speech) / (10 ** (snr_db / 20))
    return speech + noise * (target_noise_rms / rms(noise))


def main() -> int:
    if not FIXTURES.exists():
        print(f"No fixtures directory at {FIXTURES}")
        return 1

    write("noise_white.wav", 0.25 * RNG.standard_normal(SR * 2))

    # Room rumble: white noise through a one-pole low-pass, which is a fair
    # stand-in for HVAC and traffic and has no speech structure at all.
    raw = RNG.standard_normal(SR * 2)
    rumble = np.zeros_like(raw)
    for i in range(1, raw.size):
        rumble[i] = 0.995 * rumble[i - 1] + 0.005 * raw[i]
    write("noise_room.wav", 0.6 * rumble / (np.max(np.abs(rumble)) + 1e-9))

    source = FIXTURES / "speech_sank.wav"
    if not source.exists():
        print(f"\n{source.name} is missing — run make_acoustic_fixtures.ps1 first.")
        return 1

    speech, sr = sf.read(source, dtype="float32")
    assert sr == SR, f"expected {SR} Hz, got {sr}"

    write("speech_in_noise.wav", mix_at_snr(speech, RNG.standard_normal(speech.size), 3.0))

    # Driven 6x past full scale, then hard-limited: what a microphone gain
    # set far too high actually produces.
    write("clipped.wav", np.clip(speech * 6.0, -1.0, 1.0))

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
