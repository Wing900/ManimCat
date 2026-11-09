#!/usr/bin/env python3
"""Deterministic Edge-TTS worker fixture for HTTP E2E tests.

Test-only: emits a 1.2 s 440 Hz tone for every spoken segment and returns the
word-boundary contract the real worker promises. No network, no credentials.
"""
from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
import wave
from pathlib import Path

WORKER_VERSION = "2-edge-tts-7.3.1"
TICKS_PER_SECOND = 10_000_000
SAMPLE_RATE = 24_000
CHANNELS = 1
DURATION_SECONDS = 1.2
MARKER = re.compile(r"\[\[[^\]]+\]\]")


def clean_text(text: str) -> str:
    return " ".join(MARKER.sub(" ", text).split())


def write_tone(path: Path, seconds: float) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(round(seconds * SAMPLE_RATE))
    amplitude = 0.22
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(CHANNELS)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        samples = bytearray()
        for index in range(frames):
            value = int(32767 * amplitude * math.sin(2 * math.pi * 440 * index / SAMPLE_RATE))
            samples += struct.pack("<h", value)
        handle.writeframes(bytes(samples))
    return frames


def main() -> int:
    payload = json.load(sys.stdin)
    output = Path(payload["outputDirectory"])
    output.mkdir(parents=True, exist_ok=True)
    results = []
    for index, segment in enumerate(payload["segments"]):
        segment_id = str(segment["id"])
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", segment_id).strip("._") or "segment"
        wav_path = output / "segments" / f"{index:03d}-{safe}.wav"
        frames = write_tone(wav_path, DURATION_SECONDS)
        text = clean_text(str(segment["text"]))
        results.append({
            "id": segment_id,
            "wavPath": str(wav_path.resolve()),
            "duration": frames / SAMPLE_RATE,
            "frames": frames,
            "sampleRate": SAMPLE_RATE,
            "channels": CHANNELS,
            "boundaries": [{
                "text": text,
                "offsetTicks": 0,
                "durationTicks": int(0.8 * TICKS_PER_SECOND),
            }],
            "source": {"codec": "mp3"},
        })
    json.dump({
        "ok": True,
        "workerVersion": WORKER_VERSION,
        "tickRate": TICKS_PER_SECOND,
        "sampleRate": SAMPLE_RATE,
        "channels": CHANNELS,
        "segments": results,
    }, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
