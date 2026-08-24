"""
Audio ingest tests. ffmpeg and ffprobe genuinely run here — these are the
checks that catch a container the browser sends but the pipeline cannot read.
"""

from __future__ import annotations

import pytest

from app.audio import ingest
from app.config import Settings
from app.stt.errors import AudioError


@pytest.fixture
def cfg() -> Settings:
    return Settings(stt_provider="fake")


async def test_probes_a_wav(cfg, speech_wav):
    probed = await ingest.probe(speech_wav, cfg)

    assert probed.codec == "pcm_s16le"
    assert probed.sample_rate == 22050
    assert probed.channels == 1
    assert probed.duration_s == pytest.approx(1.61, abs=0.05)


async def test_probes_browser_webm(cfg, speech_webm):
    probed = await ingest.probe(speech_webm, cfg)

    assert probed.codec == "opus"
    assert probed.sample_rate == 48000
    assert "webm" in (probed.format_name or "")


async def test_normalizes_to_16k_mono_wav(cfg, speech_webm):
    result = await ingest.normalize(speech_webm, cfg)

    assert result.mime_type == "audio/wav"
    assert result.filename.endswith(".wav")
    assert result.sample_rate == 16000
    assert result.channels == 1
    assert result.data[:4] == b"RIFF"
    assert result.duration_s == pytest.approx(1.62, abs=0.1)
    # Source metadata survives normalization.
    assert result.source.codec == "opus"
    assert result.source.sample_rate == 48000


async def test_normalized_size_matches_the_declared_duration(cfg, speech_wav):
    """16-bit mono at 16 kHz is 32000 bytes per second, plus a 44-byte header."""
    result = await ingest.normalize(speech_wav, cfg)

    expected = result.duration_s * 16000 * 2
    assert len(result.data) - 44 == pytest.approx(expected, rel=0.01)


async def test_rejects_garbage(cfg, not_audio):
    with pytest.raises(AudioError) as info:
        await ingest.normalize(not_audio, cfg)
    assert info.value.code in {"INVALID_AUDIO", "NO_AUDIO_STREAM"}


async def test_rejects_empty_input(cfg):
    with pytest.raises(AudioError) as info:
        await ingest.normalize(b"", cfg)
    assert info.value.code == "EMPTY_AUDIO"


async def test_rejects_too_short(cfg, tiny_wav):
    with pytest.raises(AudioError) as info:
        await ingest.normalize(tiny_wav, cfg)
    assert info.value.code == "AUDIO_TOO_SHORT"


async def test_rejects_too_long(speech_wav):
    cfg = Settings(stt_provider="fake", max_duration_s=0.5)
    with pytest.raises(AudioError) as info:
        await ingest.normalize(speech_wav, cfg)
    assert info.value.code == "AUDIO_TOO_LONG"


async def test_rejects_oversized_upload(speech_wav):
    cfg = Settings(stt_provider="fake", max_upload_bytes=100)
    with pytest.raises(AudioError) as info:
        await ingest.normalize(speech_wav, cfg)
    assert info.value.code == "AUDIO_TOO_LARGE"
    assert info.value.http_status == 413


async def test_silence_still_normalizes(cfg, silence_wav):
    """Silence is valid audio. Rejecting it is the transcriber's business."""
    result = await ingest.normalize(silence_wav, cfg)
    assert result.duration_s == pytest.approx(1.0, abs=0.05)
