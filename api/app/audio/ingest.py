"""
Audio ingest: validate what the browser sent, then normalize it.

Browsers do not agree on a container — Chrome/Firefox/Edge give WebM/Opus,
Safari gives MP4/AAC — so everything is transcoded to 16 kHz mono WAV before
it goes anywhere. That does three jobs at once:

  1. The provider sees one format, so browser differences never reach it.
  2. 16 kHz mono is what Groq recommends, and it shrinks the upload.
  3. It is exactly the input the acoustic stage will need later
     (ARCHITECTURE.md §3.1), so this step is written once and reused.

The original capture metadata is preserved rather than discarded: the client
reports what it recorded, ffprobe measures what actually arrived, and both
are kept. Where they disagree, the server's own measurement wins.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from ..config import Settings
from ..stt.errors import AudioError


@dataclass(frozen=True)
class ProbedAudio:
    """What ffprobe found in the uploaded bytes."""

    duration_s: float
    sample_rate: int | None
    channels: int | None
    codec: str | None
    format_name: str | None


@dataclass(frozen=True)
class NormalizedAudio:
    """Transcoded audio plus both views of the metadata."""

    data: bytes
    filename: str
    mime_type: str
    sample_rate: int
    channels: int
    duration_s: float
    source: ProbedAudio


def ffmpeg_available(settings: Settings) -> bool:
    return shutil.which(settings.ffmpeg_bin) is not None


async def _run(args: list[str], stdin: bytes | None = None) -> tuple[int, bytes, bytes]:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate(input=stdin)
    return process.returncode or 0, stdout, stderr


@contextmanager
def _scratch_file(data: bytes):
    """
    Spill the upload to a temp file for the duration of one request.

    ffprobe cannot seek a pipe, and without seeking it reports no duration for
    several containers (WAV among them). A real path fixes that and lets
    ffmpeg read the same file. The file is removed in `finally` — raw audio is
    never persisted beyond the request that carried it.
    """
    fd, path = tempfile.mkstemp(prefix="phonoplay-", suffix=".audio")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        yield path
    finally:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:  # pragma: no cover - best effort cleanup
            pass


async def probe(data: bytes, settings: Settings) -> ProbedAudio:
    """Read stream metadata. Raises AudioError if the bytes are not audio."""
    with _scratch_file(data) as path:
        return await _probe_path(path, settings)


async def _probe_path(path: str, settings: Settings) -> ProbedAudio:
    code, stdout, stderr = await _run(
        [
            settings.ffprobe_bin,
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            "-select_streams", "a:0",
            "-i", path,
        ],
    )

    if code != 0:
        raise AudioError(
            "INVALID_AUDIO",
            "That recording could not be read as audio.",
        )

    try:
        parsed = json.loads(stdout or b"{}")
    except ValueError:
        raise AudioError("INVALID_AUDIO", "That recording could not be read as audio.")

    streams = parsed.get("streams") or []
    if not streams:
        raise AudioError(
            "NO_AUDIO_STREAM",
            "That file contains no audio track.",
        )

    stream = streams[0]
    container = parsed.get("format") or {}

    # Duration can live on either the stream or the container, and WebM from
    # MediaRecorder frequently carries neither.
    duration = _as_float(stream.get("duration")) or _as_float(container.get("duration")) or 0.0

    return ProbedAudio(
        duration_s=duration,
        sample_rate=_as_int(stream.get("sample_rate")),
        channels=_as_int(stream.get("channels")),
        codec=stream.get("codec_name"),
        format_name=container.get("format_name"),
    )


async def normalize(data: bytes, settings: Settings) -> NormalizedAudio:
    """
    Validate then transcode to 16 kHz mono WAV.

    Raises:
        AudioError: empty, oversized, unreadable, or out-of-range audio.
    """
    if not data:
        raise AudioError("EMPTY_AUDIO", "The upload contained no audio data.")

    if len(data) > settings.max_upload_bytes:
        raise AudioError(
            "AUDIO_TOO_LARGE",
            "That recording is too large to process.",
            http_status=413,
        )

    if not ffmpeg_available(settings):
        raise AudioError(
            "FFMPEG_MISSING",
            "Audio processing is unavailable on this server.",
            http_status=503,
            retryable=False,
        )

    with _scratch_file(data) as path:
        source = await _probe_path(path, settings)

        code, stdout, stderr = await _run(
            [
                settings.ffmpeg_bin,
                "-hide_banner", "-loglevel", "error",
                "-i", path,
                "-map", "a:0",
                "-ac", str(settings.target_channels),
                "-ar", str(settings.target_sample_rate),
                "-c:a", "pcm_s16le",
                "-f", "wav",
                "pipe:1",
            ],
        )

    if code != 0 or not stdout:
        detail = (stderr or b"").decode("utf-8", "replace").strip().splitlines()
        raise AudioError(
            "TRANSCODE_FAILED",
            "That recording could not be converted for analysis."
            + (f" ({detail[-1][:160]})" if detail else ""),
        )

    # Measure the transcoded result — WAV always carries a real duration, so
    # this is authoritative even when the source container had none.
    duration = _wav_duration(stdout, settings) or source.duration_s

    if duration < settings.min_duration_s:
        raise AudioError(
            "AUDIO_TOO_SHORT",
            "That recording is too short to transcribe.",
        )
    if duration > settings.max_duration_s:
        raise AudioError(
            "AUDIO_TOO_LONG",
            f"Recordings must be under {settings.max_duration_s:.0f} seconds.",
        )

    return NormalizedAudio(
        data=stdout,
        filename="attempt.wav",
        mime_type="audio/wav",
        sample_rate=settings.target_sample_rate,
        channels=settings.target_channels,
        duration_s=round(duration, 3),
        source=source,
    )


def _wav_duration(wav: bytes, settings: Settings) -> float | None:
    """
    Duration straight from the PCM payload size.

    Cheaper and more reliable than a second ffprobe pass: we produced this
    file, so the frame size is known exactly.
    """
    if len(wav) <= 44:
        return None
    bytes_per_frame = 2 * settings.target_channels  # pcm_s16le
    frames = (len(wav) - 44) / bytes_per_frame
    if frames <= 0:
        return None
    return frames / settings.target_sample_rate


def _as_float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _as_int(value: object) -> int | None:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
