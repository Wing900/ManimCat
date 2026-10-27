#!/usr/bin/env python3
"""Edge TTS worker for ManimCat narration.

The TypeScript narrator owns the plan, cue markers, cache and cancellation. This
process only turns plain spoken text into per-segment WAV files plus the word
boundaries the narrator needs to place cues.

Contract notes:
  * ``boundary="WordBoundary"`` is passed explicitly. The service reports offsets
    in 100-nanosecond ticks (10_000_000 ticks per second), not milliseconds.
  * Edge streams MP3. The bytes are verified with ffprobe (``codec_name=mp3``)
    and decoded to mono 16-bit PCM WAV with FFmpeg. Renaming an MP3 to ``.wav``
    would leave garbage that FFmpeg muxing/Manim timing cannot trust.
  * No credentials are read or printed. The service is keyless.
  * Input is one JSON object on stdin; stdout carries one JSON object. Diagnostics
    go to stderr so a caller can report a real service failure instead of silence.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

WORKER_VERSION = "2-edge-tts-7.3.1"
TICKS_PER_SECOND = 10_000_000
DEFAULT_SAMPLE_RATE = 24_000
DEFAULT_TIMEOUT_SECONDS = 180
MAX_CONCURRENCY = 3
RETRY_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = 1.0


class WorkerError(Exception):
    """A failure that must be reported to the narrator, never papered over."""

    def __init__(self, code: str, message: str, segment_id: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.segment_id = segment_id
        self.message = message


def emit(payload: Dict[str, Any]) -> None:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.buffer.write(data.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()


def log(message: str, **fields: Any) -> None:
    record = {"level": "info", "message": message, **fields}
    data = json.dumps(record, ensure_ascii=False, default=str)
    sys.stderr.buffer.write(data.encode("utf-8"))
    sys.stderr.buffer.write(b"\n")
    sys.stderr.buffer.flush()


def _require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise WorkerError("INVALID_INPUT", f"{label} must be a non-empty string")
    return value.strip()


def _safe_name(segment_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", segment_id).strip("._")
    return (cleaned or "segment")[:80]


def _is_mp3_header(data: bytes) -> bool:
    if not data:
        return False
    if data[:3] == b"ID3":
        return True
    # MPEG audio frame sync: 11 set bits, then a non-zero version/layer nibble.
    return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


def read_wav_info(path: Path) -> Dict[str, Any]:
    """Read a canonical PCM WAV header and derive the exact duration in frames."""
    with path.open("rb") as handle:
        riff = handle.read(12)
        if len(riff) != 12 or riff[:4] != b"RIFF" or riff[8:12] != b"WAVE":
            raise WorkerError("WAV_INVALID", f"not a RIFF/WAVE file: {path.name}")
        fmt: Optional[Dict[str, int]] = None
        data_size: Optional[int] = None
        while True:
            header = handle.read(8)
            if len(header) < 8:
                break
            chunk_id = header[:4]
            chunk_size = int.from_bytes(header[4:8], "little")
            if chunk_id == b"fmt ":
                payload = handle.read(chunk_size)
                if len(payload) < 16:
                    raise WorkerError("WAV_INVALID", f"short fmt chunk: {path.name}")
                fmt = {
                    "audio_format": int.from_bytes(payload[0:2], "little"),
                    "channels": int.from_bytes(payload[2:4], "little"),
                    "sample_rate": int.from_bytes(payload[4:8], "little"),
                    "byte_rate": int.from_bytes(payload[8:12], "little"),
                    "block_align": int.from_bytes(payload[12:14], "little"),
                    "bits_per_sample": int.from_bytes(payload[14:16], "little"),
                }
                if chunk_size % 2:
                    handle.read(1)
            elif chunk_id == b"data":
                data_size = chunk_size
                break
            else:
                handle.seek(chunk_size + (chunk_size % 2), os.SEEK_CUR)
        if fmt is None or data_size is None:
            raise WorkerError("WAV_INVALID", f"missing fmt or data chunk: {path.name}")
        if fmt["audio_format"] != 1:
            raise WorkerError(
                "WAV_INVALID",
                f"expected PCM format 1, got {fmt['audio_format']}: {path.name}",
            )
        if fmt["bits_per_sample"] != 16:
            raise WorkerError(
                "WAV_INVALID",
                f"expected 16-bit samples, got {fmt['bits_per_sample']}: {path.name}",
            )
        if fmt["block_align"] <= 0:
            raise WorkerError("WAV_INVALID", f"invalid block alignment: {path.name}")
        if data_size % fmt["block_align"]:
            raise WorkerError("WAV_INVALID", f"partial sample frame in data chunk: {path.name}")
        frames = data_size // fmt["block_align"]
        if frames <= 0:
            raise WorkerError("WAV_EMPTY", f"decoded audio has no samples: {path.name}")
        duration = frames / float(fmt["sample_rate"])
        return {**fmt, "frames": frames, "duration": duration, "data_size": data_size}


async def run_command(command: Sequence[str], timeout_seconds: float) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
    except asyncio.CancelledError:
        proc.kill()
        await proc.wait()
        raise
    except asyncio.TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise WorkerError(
            "FFMPEG_TIMEOUT",
            f"{Path(command[0]).name} timed out after {timeout_seconds:g}s",
        ) from exc
    if proc.returncode != 0:
        tail = stderr.decode("utf-8", errors="replace").strip()[-2000:]
        raise WorkerError(
            "FFMPEG_FAILED",
            f"{Path(command[0]).name} exited {proc.returncode}: {tail or 'no stderr'}",
        )
    return stdout


async def probe_mp3(path: Path, ffprobe: str, timeout_seconds: float) -> Dict[str, Any]:
    stdout = await run_command(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels,duration",
            "-of",
            "json",
            str(path),
        ],
        timeout_seconds,
    )
    try:
        payload = json.loads(stdout.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        raise WorkerError("MP3_PROBE_FAILED", f"ffprobe returned invalid JSON: {exc}") from exc
    streams = payload.get("streams")
    if not isinstance(streams, list) or not streams:
        raise WorkerError("MP3_PROBE_FAILED", "ffprobe found no audio stream in the Edge response")
    stream = streams[0]
    codec = str(stream.get("codec_name") or "")
    if codec != "mp3":
        raise WorkerError(
            "NOT_MP3",
            f"Edge response is not MP3 (ffprobe codec_name={codec or 'unknown'})",
        )
    try:
        sample_rate = int(stream.get("sample_rate") or 0)
        channels = int(stream.get("channels") or 0)
    except (TypeError, ValueError) as exc:
        raise WorkerError("MP3_PROBE_FAILED", "ffprobe returned invalid sample metadata") from exc
    return {
        "codec": codec,
        "sampleRate": sample_rate,
        "channels": channels,
        "duration": float(stream.get("duration") or 0),
    }


async def convert_mp3_to_wav(
    mp3_path: Path,
    wav_path: Path,
    ffmpeg: str,
    sample_rate: int,
    timeout_seconds: float,
) -> None:
    temp_path = wav_path.with_name(wav_path.name + ".part")
    temp_path.unlink(missing_ok=True)
    args = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(mp3_path),
        "-vn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        str(temp_path),
    ]
    try:
        await run_command(args, timeout_seconds)
        if not temp_path.is_file() or temp_path.stat().st_size <= 44:
            raise WorkerError("WAV_EMPTY", "FFmpeg produced no decoded audio")
        os.replace(temp_path, wav_path)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise


def _retryable(error: BaseException) -> bool:
    """Only transport-level failures are retried; a bad voice stays a bad voice."""
    try:
        import aiohttp
        import edge_tts.exceptions as edge_exceptions
    except ImportError:
        return False
    if isinstance(error, (asyncio.TimeoutError, aiohttp.ClientError)):
        return True
    if isinstance(error, edge_exceptions.EdgeTTSException):
        # NoAudioReceived usually means an invalid voice/text parameter; retrying
        # spends another online request without changing the outcome.
        return not isinstance(
            error,
            (edge_exceptions.NoAudioReceived, edge_exceptions.SkewAdjustmentError),
        )
    return False


def _describe_error(error: BaseException) -> str:
    message = str(error).strip()
    return message or error.__class__.__name__


async def stream_edge_audio(
    communicate: Any,
    mp3_part: Path,
) -> tuple[int, bytes, List[Dict[str, Any]]]:
    """Stream one synthesis attempt to a .part file and collect word boundaries."""
    boundaries: List[Dict[str, Any]] = []
    audio_bytes = 0
    first_bytes = b""
    with mp3_part.open("wb") as handle:
        async for chunk in communicate.stream():
            kind = chunk.get("type")
            if kind == "audio":
                data = chunk.get("data") or b""
                if not data:
                    continue
                if len(first_bytes) < 4:
                    first_bytes += data[: 4 - len(first_bytes)]
                audio_bytes += len(data)
                handle.write(data)
            elif kind == "WordBoundary":
                raw_offset = chunk.get("offset")
                raw_duration = chunk.get("duration")
                if not isinstance(raw_offset, int) or not isinstance(raw_duration, int):
                    continue
                boundaries.append(
                    {
                        "text": str(chunk.get("text") or ""),
                        "offsetTicks": raw_offset,
                        "durationTicks": raw_duration,
                    }
                )
    return audio_bytes, first_bytes, boundaries


async def synthesize_segment(
    index: int,
    segment: Dict[str, str],
    output_directory: Path,
    semaphore: asyncio.Semaphore,
    ffmpeg: str,
    ffprobe: str,
    sample_rate: int,
    timeout_seconds: float,
) -> Dict[str, Any]:
    import edge_tts

    segment_id = segment["id"]
    text = segment["text"]
    voice = segment["voice"]
    rate = segment["rate"]

    async with semaphore:
        stem = f"{index:03d}-{_safe_name(segment_id)}"
        mp3_path = output_directory / f"{stem}.mp3"
        wav_path = output_directory / f"{stem}.wav"
        mp3_part = mp3_path.with_name(mp3_path.name + ".part")
        wav_path.unlink(missing_ok=True)
        mp3_part.unlink(missing_ok=True)

        last_error: Optional[BaseException] = None
        for attempt in range(1, RETRY_ATTEMPTS + 1):
            try:
                # Explicit WordBoundary: SentenceBoundary cannot place cue markers
                # that live inside a sentence. wait_for also bounds a stalled online
                # stream instead of letting a job hang indefinitely.
                communicate = edge_tts.Communicate(
                    text,
                    voice,
                    rate=rate,
                    boundary="WordBoundary",
                )
                audio_bytes, first_bytes, boundaries = await asyncio.wait_for(
                    stream_edge_audio(communicate, mp3_part),
                    timeout=timeout_seconds,
                )
                if audio_bytes <= 0:
                    raise WorkerError(
                        "TTS_NO_AUDIO",
                        "Edge returned no audio data for this segment",
                        segment_id,
                    )
                if not _is_mp3_header(first_bytes):
                    raise WorkerError(
                        "NOT_MP3",
                        "Edge response does not start with an MP3 frame or ID3 tag",
                        segment_id,
                    )
                os.replace(mp3_part, mp3_path)

                media = await probe_mp3(mp3_path, ffprobe, timeout_seconds)
                if media["duration"] <= 0:
                    raise WorkerError(
                        "MP3_PROBE_FAILED",
                        "ffprobe reported a zero-length MP3",
                        segment_id,
                    )
                await convert_mp3_to_wav(
                    mp3_path,
                    wav_path,
                    ffmpeg,
                    sample_rate,
                    timeout_seconds,
                )
                wav = read_wav_info(wav_path)
                if wav["sample_rate"] != sample_rate:
                    raise WorkerError(
                        "WAV_FORMAT_MISMATCH",
                        f"decoded sample rate {wav['sample_rate']} != {sample_rate}",
                        segment_id,
                    )
                if wav["channels"] != 1:
                    raise WorkerError(
                        "WAV_FORMAT_MISMATCH",
                        f"decoded channel count {wav['channels']} != 1",
                        segment_id,
                    )
                boundaries.sort(key=lambda item: int(item["offsetTicks"]))
                try:
                    mp3_path.unlink(missing_ok=True)
                except OSError:
                    pass
                log(
                    "segment synthesized",
                    id=segment_id,
                    duration=round(float(wav["duration"]), 6),
                    boundaries=len(boundaries),
                )
                return {
                    "id": segment_id,
                    "wavPath": str(wav_path.resolve()),
                    "duration": float(wav["duration"]),
                    "frames": int(wav["frames"]),
                    "sampleRate": int(wav["sample_rate"]),
                    "channels": int(wav["channels"]),
                    "boundaries": boundaries,
                    "source": media,
                }
            except asyncio.CancelledError:
                mp3_part.unlink(missing_ok=True)
                mp3_path.unlink(missing_ok=True)
                raise
            except BaseException as error:
                mp3_part.unlink(missing_ok=True)
                mp3_path.unlink(missing_ok=True)
                wav_path.unlink(missing_ok=True)
                last_error = error
                if attempt < RETRY_ATTEMPTS and _retryable(error):
                    log(
                        "segment synthesis retry",
                        id=segment_id,
                        attempt=attempt,
                        error=_describe_error(error),
                    )
                    await asyncio.sleep(RETRY_BACKOFF_SECONDS * attempt)
                    continue
                break

        assert last_error is not None
        if isinstance(last_error, WorkerError):
            if last_error.segment_id is None:
                last_error.segment_id = segment_id
            raise last_error
        raise WorkerError(
            "TTS_FAILED",
            f"Edge TTS failed for segment {segment_id!r}: {_describe_error(last_error)}",
            segment_id,
        )


def parse_input(raw: bytes) -> Dict[str, Any]:
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkerError("INVALID_INPUT", f"stdin is not UTF-8 JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise WorkerError("INVALID_INPUT", "stdin JSON must be an object")

    output_directory = Path(_require_string(payload.get("outputDirectory"), "outputDirectory"))
    segments_value = payload.get("segments")
    if not isinstance(segments_value, list) or not segments_value:
        raise WorkerError("INVALID_INPUT", "segments must be a non-empty array")

    seen = set()
    segments: List[Dict[str, str]] = []
    for index, value in enumerate(segments_value):
        if not isinstance(value, dict):
            raise WorkerError("INVALID_INPUT", f"segments[{index}] must be an object")
        segment_id = _require_string(value.get("id"), f"segments[{index}].id")
        if segment_id in seen:
            raise WorkerError("INVALID_INPUT", f"duplicate segment id {segment_id!r}")
        seen.add(segment_id)
        segments.append(
            {
                "id": segment_id,
                "text": _require_string(value.get("text"), f"segments[{index}].text"),
                "voice": _require_string(value.get("voice"), f"segments[{index}].voice"),
                "rate": _require_string(value.get("rate"), f"segments[{index}].rate"),
            }
        )

    try:
        concurrency = int(payload.get("concurrency", 3))
    except (TypeError, ValueError) as exc:
        raise WorkerError("INVALID_INPUT", "concurrency must be an integer") from exc
    concurrency = max(1, min(MAX_CONCURRENCY, concurrency))

    try:
        sample_rate = int(payload.get("sampleRate", DEFAULT_SAMPLE_RATE))
    except (TypeError, ValueError) as exc:
        raise WorkerError("INVALID_INPUT", "sampleRate must be an integer") from exc
    if sample_rate < 8000 or sample_rate > 48000:
        raise WorkerError("INVALID_INPUT", f"unsupported sampleRate {sample_rate}")

    try:
        timeout_seconds = float(payload.get("timeoutSeconds", DEFAULT_TIMEOUT_SECONDS))
    except (TypeError, ValueError) as exc:
        raise WorkerError("INVALID_INPUT", "timeoutSeconds must be a number") from exc
    if timeout_seconds <= 0:
        raise WorkerError("INVALID_INPUT", "timeoutSeconds must be positive")

    return {
        "outputDirectory": output_directory,
        "segments": segments,
        "concurrency": concurrency,
        "sampleRate": sample_rate,
        "timeoutSeconds": timeout_seconds,
        "ffmpeg": str(payload.get("ffmpegPath") or os.environ.get("FFMPEG_PATH") or "ffmpeg"),
        "ffprobe": str(payload.get("ffprobePath") or os.environ.get("FFPROBE_PATH") or "ffprobe"),
    }


async def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import edge_tts  # noqa: F401
    except ImportError as exc:
        raise WorkerError(
            "MISSING_DEPENDENCY",
            "edge-tts is not installed in the selected Python interpreter; install requirements.txt",
        ) from exc

    output_directory: Path = payload["outputDirectory"]
    output_directory.mkdir(parents=True, exist_ok=True)
    segments_directory: Path = output_directory / "segments"
    segments_directory.mkdir(parents=True, exist_ok=True)

    segments = payload["segments"]
    semaphore = asyncio.Semaphore(payload["concurrency"])
    results: List[Optional[Dict[str, Any]]] = [None] * len(segments)

    async def worker(index: int, segment: Dict[str, str]) -> None:
        results[index] = await synthesize_segment(
            index,
            segment,
            segments_directory,
            semaphore,
            payload["ffmpeg"],
            payload["ffprobe"],
            payload["sampleRate"],
            payload["timeoutSeconds"],
        )

    tasks = [
        asyncio.create_task(worker(index, segment))
        for index, segment in enumerate(segments)
    ]
    try:
        await asyncio.gather(*tasks)
    except BaseException as error:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if isinstance(error, WorkerError):
            raise error
        raise WorkerError(
            "TTS_FAILED",
            f"Edge TTS worker failed: {_describe_error(error)}",
        ) from error

    return {
        "ok": True,
        "workerVersion": WORKER_VERSION,
        "tickRate": TICKS_PER_SECOND,
        "sampleRate": payload["sampleRate"],
        "channels": 1,
        "segments": results,
    }


def main() -> int:
    try:
        payload = parse_input(sys.stdin.buffer.read())
        result = asyncio.run(run(payload))
        emit(result)
        return 0
    except WorkerError as error:
        emit(
            {
                "ok": False,
                "error": {
                    "code": error.code,
                    "message": error.message,
                    "segmentId": error.segment_id,
                },
            }
        )
        return 2
    except KeyboardInterrupt:
        return 130
    except BaseException as error:  # never exit with a half-written success object
        emit(
            {
                "ok": False,
                "error": {
                    "code": "WORKER_CRASH",
                    "message": _describe_error(error),
                    "segmentId": None,
                },
            }
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
