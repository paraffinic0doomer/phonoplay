from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.config import Settings

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    return FIXTURES


@pytest.fixture
def settings() -> Settings:
    """Settings that never reach the network."""
    return Settings(
        stt_provider="fake",
        groq_api_key="test-key",
        stt_max_retries=1,
        stt_retry_backoff=0.0,
        stt_max_retry_delay=0.0,
    )


@pytest.fixture(scope="session")
def speech_wav() -> bytes:
    """Real speech saying "sun" (Windows TTS), 22 kHz mono WAV."""
    return (FIXTURES / "speech_sun.wav").read_bytes()


@pytest.fixture(scope="session")
def speech_webm() -> bytes:
    """The same speech in the container Chrome actually uploads."""
    return (FIXTURES / "speech_sun.webm").read_bytes()


@pytest.fixture(scope="session")
def silence_wav() -> bytes:
    return (FIXTURES / "silence_1s.wav").read_bytes()


@pytest.fixture(scope="session")
def tiny_wav() -> bytes:
    """50 ms — below min_duration_s."""
    return (FIXTURES / "tiny_50ms.wav").read_bytes()


@pytest.fixture(scope="session")
def not_audio() -> bytes:
    return (FIXTURES / "not_audio.bin").read_bytes()


@pytest.fixture(scope="session")
def groq_verbose_json() -> dict:
    """
    A real Groq verbose_json response, captured by scripts/capture_fixture.py.
    Asserting against this rather than a hand-written sample means the
    normalization tests track what the provider actually sends.
    """
    return json.loads((FIXTURES / "groq_verbose_json.json").read_text(encoding="utf-8"))


# ── Acoustic stage fixtures ──────────────────────────────────────────
#
# These words are deliberately absent from the reference corpus the profiles
# were built from (scripts/build_reference_corpus.ps1). Held-out minimal
# pairs are what make an assertion about accuracy mean anything: testing on
# the corpus would only show that the profiles describe their own source.
#
# Regenerate with scripts/make_acoustic_fixtures.{ps1,py}.


def _fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


@pytest.fixture(scope="session")
def sank_wav() -> bytes:
    """A correct /s/ — "sank"."""
    return _fixture_bytes("speech_sank.wav")


@pytest.fixture(scope="session")
def sank_zira_wav() -> bytes:
    """The same word from a second voice, to catch speaker-specific tuning."""
    return _fixture_bytes("speech_sank_zira.wav")


@pytest.fixture(scope="session")
def thank_wav() -> bytes:
    """"thank" — the minimal pair for "sank". An /s/ produced as /th/."""
    return _fixture_bytes("speech_thank.wav")


@pytest.fixture(scope="session")
def rag_wav() -> bytes:
    """A correct /r/ — "rag"."""
    return _fixture_bytes("speech_rag.wav")


@pytest.fixture(scope="session")
def rabbit_wav() -> bytes:
    """
    A correct /r/ in a two-syllable word - "rabbit".

    Held out from the reference corpus words used by the other fixtures, and
    the only spoken fixture whose voiced run is long enough for the onset
    window to run past the constriction into the following vowel. That is the
    condition that produced a false /l/ substitution on a correct production;
    see MAX_APPROXIMANT_S in acoustic/segment.py.
    """
    return _fixture_bytes("speech_rabbit.wav")


@pytest.fixture(scope="session")
def wag_wav() -> bytes:
    """"wag" — an /r/ produced as /w/, the dominant English pattern."""
    return _fixture_bytes("speech_wag.wav")


@pytest.fixture(scope="session")
def lace_wav() -> bytes:
    """A correct /l/ — "lace"."""
    return _fixture_bytes("speech_lace.wav")


@pytest.fixture(scope="session")
def race_wav() -> bytes:
    """"race" — an /l/ produced as /r/."""
    return _fixture_bytes("speech_race.wav")


@pytest.fixture(scope="session")
def white_noise_wav() -> bytes:
    return _fixture_bytes("noise_white.wav")


@pytest.fixture(scope="session")
def room_noise_wav() -> bytes:
    return _fixture_bytes("noise_room.wav")


@pytest.fixture(scope="session")
def noisy_speech_wav() -> bytes:
    """Real speech at ~3 dB global SNR. The "uncertain audio" case."""
    return _fixture_bytes("speech_in_noise.wav")


@pytest.fixture(scope="session")
def clipped_wav() -> bytes:
    """Speech driven 6x past full scale."""
    return _fixture_bytes("clipped.wav")
