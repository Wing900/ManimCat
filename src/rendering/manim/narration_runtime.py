"""Narration sync: cue / reveal_until / play_until / narration_end.

The runtime is attached to one scene instance by the runner. It never patches the
``Scene`` class, so ``Scene`` and ``ThreeDScene`` keep their normal behaviour and a
render without ``--narration`` is byte-for-byte the old path.

Cue times come from the backend manifest. Top-level ``cues`` are absolute seconds in
the final audio track; ``segments[*].cues`` are seconds inside that segment and are
cross-checked for reporting. The manifest is the only source of truth: a cue is never
silently moved to 0, skipped, or re-estimated from the video clock.

The report records, for every cue:

* the audio target (seconds and frame),
* the exact scene clock after waiting/playing,
* the GX frame number and its frame time,
* the exact latency and the frame-quantised visual latency.

An overdue cue, an unknown cue, or a play that cannot land on its budget is a hard
error: rendering stops and the report keeps the failure. A missing ending tail is
filled by the runtime after ``construct`` so the last words are not cut off.
"""

from __future__ import annotations

import json
import math
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable

try:  # GX's own frame rule: first frame at or after an observed instant.
    from manimgx.animation.clock import frame_at as _gx_frame_at
except Exception:  # pragma: no cover - the runner imports manimgx before this module

    def _gx_frame_at(time: float | Fraction, rate: Fraction, *, after: bool = False) -> int:
        value = Fraction(time) * rate
        return -((-value.numerator) // value.denominator)


VERSION = 1
EPS = Fraction(1, 1_000_000)  # one microsecond; smaller differences are float noise
SEGMENT_CROSS_CHECK = 0.002  # 2 ms: only catches a real segment/top-level disagreement
REVEAL_SECONDS = Fraction(3, 5)  # Reveal promptly, then hold the result for reading.


class NarrationError(RuntimeError):
    """Base error for a narration manifest or sync contract violation."""


class NarrationManifestError(NarrationError):
    """The manifest cannot be used as the single timing source."""


class NarrationSyncError(NarrationError):
    """A cue is missing or the scene has already passed it."""


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise NarrationManifestError(f"{label} must be a number, got {type(value).__name__}")
    result = float(value)
    if not math.isfinite(result):
        raise NarrationManifestError(f"{label} must be finite, got {value!r}")
    return result


def _seconds(value: Any, label: str) -> Fraction:
    """Exact decimal seconds, so 1.234 means 1.234 and not its binary neighbour."""
    number = _number(value, label)
    try:
        return Fraction(Decimal(str(number)))
    except (InvalidOperation, ValueError) as exc:
        raise NarrationManifestError(f"{label} is not a decimal number: {value!r}") from exc


def _frame(seconds: Fraction, fps: int) -> int:
    return int(_gx_frame_at(seconds, Fraction(fps)))


def _resolve_path(value: str, manifest_path: Path) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = manifest_path.parent / path
    return path


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def write_error_report(
    report_path: Path,
    manifest_path: Path,
    fps: int,
    error: BaseException,
) -> None:
    """Keep a usable report even when the manifest cannot be loaded at all."""
    message = f"{type(error).__name__}: {error}"
    _atomic_json(
        report_path,
        {
            "version": VERSION,
            "status": "error",
            "manifestPath": str(manifest_path),
            "fps": fps,
            "audioPath": None,
            "outputPath": None,
            "audioDuration": None,
            "sceneDuration": None,
            "frameCount": None,
            "cues": [],
            "unusedCues": [],
            "warnings": [],
            "errors": [message],
            "plays": [],
        },
    )


class NarrationRuntime:
    """Per-scene narration clock. Construct one instance per scene/render."""

    def __init__(self, manifest_path: str | Path, fps: int) -> None:
        if not isinstance(fps, int) or fps <= 0:
            raise NarrationManifestError(f"fps must be a positive integer, got {fps!r}")
        self.manifest_path = Path(manifest_path).resolve()
        self.fps = fps
        self.scene: Any = None
        self.audio_path: Path | None = None
        self.audio_duration: Fraction = Fraction(0)
        self.cues: dict[str, Fraction] = {}
        self.segment_for_cue: dict[str, dict[str, Any]] = {}
        self.segments: list[dict[str, Any]] = []
        self.warnings: list[str] = []
        self.errors: list[str] = []
        self.cue_reports: list[dict[str, Any]] = []
        self.endings: list[dict[str, Any]] = []
        self.plays: list[dict[str, Any]] = []
        self.used: dict[str, int] = {}
        self.output_path: Path | None = None
        self._film: Any = None
        self._finished = False
        self._short_video_warned = False
        self._load()

    # ── manifest ─────────────────────────────────────────────────────────────
    def _load(self) -> None:
        try:
            document = json.loads(self.manifest_path.read_text(encoding="utf-8-sig"))
        except FileNotFoundError as exc:
            raise NarrationManifestError(
                f"narration manifest does not exist: {self.manifest_path}"
            ) from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise NarrationManifestError(
                f"cannot read narration manifest {self.manifest_path}: {exc}"
            ) from exc
        if not isinstance(document, dict):
            raise NarrationManifestError("narration manifest must be a JSON object")
        version = document.get("version")
        if version != VERSION or isinstance(version, bool):
            raise NarrationManifestError(
                f"unsupported narration manifest version {version!r}; expected {VERSION}"
            )

        self.audio_duration = _seconds(document.get("duration"), "duration")
        if self.audio_duration <= 0:
            raise NarrationManifestError("duration must be positive")

        audio = document.get("audioPath")
        if not isinstance(audio, str) or not audio.strip():
            raise NarrationManifestError("audioPath must be a non-empty string")
        self.audio_path = _resolve_path(audio, self.manifest_path)
        if not self.audio_path.is_file():
            raise NarrationManifestError(
                f"narration audio does not exist: {self.audio_path}"
            )

        raw_cues = document.get("cues")
        if not isinstance(raw_cues, dict):
            raise NarrationManifestError("cues must be an object of cue id -> seconds")
        for cue_id, value in raw_cues.items():
            if not isinstance(cue_id, str) or not cue_id:
                raise NarrationManifestError(f"cue id must be a non-empty string: {cue_id!r}")
            target = _seconds(value, f"cues[{cue_id!r}]")
            if target < 0:
                raise NarrationManifestError(f"cue {cue_id!r} is before audio start")
            if target > self.audio_duration + EPS:
                raise NarrationManifestError(
                    f"cue {cue_id!r} at {float(target):.6f}s is past audio duration "
                    f"{float(self.audio_duration):.6f}s"
                )
            self.cues[cue_id] = target

        self._load_segments(document.get("segments", []))

    def _load_segments(self, raw_segments: Any) -> None:
        if raw_segments is None:
            return
        if not isinstance(raw_segments, list):
            raise NarrationManifestError("segments must be an array")
        seen: set[str] = set()
        for index, raw in enumerate(raw_segments):
            if not isinstance(raw, dict):
                raise NarrationManifestError(f"segments[{index}] must be an object")
            segment_id = raw.get("id")
            if not isinstance(segment_id, str) or not segment_id:
                raise NarrationManifestError(
                    f"segments[{index}].id must be a non-empty string"
                )
            if segment_id in seen:
                raise NarrationManifestError(f"duplicate segment id {segment_id!r}")
            seen.add(segment_id)
            start = _seconds(raw.get("start"), f"segments[{index}].start")
            duration = _seconds(raw.get("duration"), f"segments[{index}].duration")
            if start < 0 or duration < 0:
                raise NarrationManifestError(
                    f"segment {segment_id!r} has negative start or duration"
                )
            if start + duration > self.audio_duration + EPS:
                self.warnings.append(
                    f"segment {segment_id!r} ends past audio duration "
                    f"({float(start + duration):.6f}s > {float(self.audio_duration):.6f}s)"
                )
            segment_cues = raw.get("cues", {})
            if not isinstance(segment_cues, dict):
                raise NarrationManifestError(
                    f"segments[{index}].cues must be an object"
                )
            resolved: dict[str, Fraction] = {}
            for cue_id, value in segment_cues.items():
                if not isinstance(cue_id, str) or not cue_id:
                    raise NarrationManifestError(
                        f"segments[{index}].cues has a non-string id: {cue_id!r}"
                    )
                relative = _seconds(value, f"segments[{index}].cues[{cue_id!r}]")
                if relative < 0:
                    raise NarrationManifestError(
                        f"segment cue {cue_id!r} is before its segment start"
                    )
                absolute = start + relative
                resolved[cue_id] = absolute
                top = self.cues.get(cue_id)
                if top is None:
                    self.warnings.append(
                        f"segment {segment_id!r} names cue {cue_id!r} absent from top-level cues"
                    )
                elif abs(float(top - absolute)) > SEGMENT_CROSS_CHECK:
                    self.warnings.append(
                        f"cue {cue_id!r} disagrees between segments and top-level cues "
                        f"({float(absolute):.6f}s vs {float(top):.6f}s)"
                    )
                if cue_id not in self.segment_for_cue:
                    self.segment_for_cue[cue_id] = {
                        "id": segment_id,
                        "start": float(start),
                        "relative": float(relative),
                    }
            self.segments.append(
                {
                    "id": segment_id,
                    "start": float(start),
                    "duration": float(duration),
                    "cues": {key: float(value) for key, value in resolved.items()},
                }
            )

    # ── scene attachment ─────────────────────────────────────────────────────
    def attach(self, scene: Any) -> None:
        """Attach instance methods; no class or module is patched."""
        if self.scene is not None:
            raise NarrationError("this NarrationRuntime is already attached")
        for name in ("cue", "reveal_until", "play_until", "narration_end"):
            if hasattr(scene, name):
                raise NarrationError(
                    f"scene already defines {name!r}; refusing to shadow it"
                )
        self.scene = scene
        scene.cue = self.cue
        scene.reveal_until = self.reveal_until
        scene.play_until = self.play_until
        scene.narration_end = self.narration_end

        original_construct: Callable[[], None] = scene.construct

        def construct() -> None:
            original_construct()
            # The generated code is expected to call narration_end itself; doing it
            # again here is idempotent and guarantees the audio tail is not cut off.
            self.narration_end()

        scene.construct = construct

    # ── timing helpers ───────────────────────────────────────────────────────
    @property
    def now(self) -> Fraction:
        return Fraction(self.scene.clock)

    def target(self, name: str, mode: str) -> Fraction:
        if not isinstance(name, str) or not name:
            message = f"{mode} needs a non-empty cue name, got {name!r}"
            self.errors.append(message)
            raise NarrationSyncError(message)
        try:
            return self.cues[name]
        except KeyError:
            message = f"{mode}: unknown cue {name!r}"
            self.errors.append(message)
            self.cue_reports.append(
                {
                    "id": name,
                    "mode": mode,
                    "status": "missing",
                    "target": None,
                    "message": message,
                }
            )
            raise NarrationSyncError(message) from None

    def _entry(self, name: str, mode: str, target: Fraction) -> dict[str, Any]:
        frame = _frame(target, self.fps)
        segment = self.segment_for_cue.get(name)
        return {
            "id": name,
            "mode": mode,
            "target": float(target),
            "targetFrame": frame,
            "targetFrameTime": frame / self.fps,
            "segment": None if segment is None else segment["id"],
            "segmentStart": None if segment is None else segment["start"],
            "segmentCue": None if segment is None else segment["relative"],
            "status": "ok",
        }

    def _record_no_budget(self, name: str, target: Fraction, now: Fraction, mode: str = "play_until") -> None:
        entry = self._entry(name, mode, target)
        entry.update(
            {
                "status": "no_time",
                "actualTime": float(now),
                "actualFrame": int(self.scene.frame),
                "actualFrameTime": int(self.scene.frame) / self.fps,
                "latencySeconds": float(now - target),
                "latencyFrames": int(self.scene.frame) - int(entry["targetFrame"]),
                "visualLatencySeconds": (int(entry["targetFrame"]) / self.fps)
                - float(target),
                "clock": [now.numerator, now.denominator],
            }
        )
        self.cue_reports.append(entry)
        message = (
            f"{mode}: no time left before cue {name!r}; scene is at "
            f"{float(now):.6f}s, target {float(target):.6f}s"
        )
        self.errors.append(message)
        raise NarrationSyncError(message)

    def _finish_entry(
        self, entry: dict[str, Any], target: Fraction, extra: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        now = self.now
        latency = now - target
        entry.update(
            {
                "actualTime": float(now),
                "actualFrame": int(self.scene.frame),
                "actualFrameTime": int(self.scene.frame) / self.fps,
                "latencySeconds": float(latency),
                "latencyFrames": int(self.scene.frame) - int(entry["targetFrame"]),
                "visualLatencySeconds": (int(entry["targetFrame"]) / self.fps)
                - float(target),
                "clock": [now.numerator, now.denominator],
            }
        )
        if extra:
            entry.update(extra)
        self.cue_reports.append(entry)
        if abs(float(latency)) > float(EPS):
            entry["status"] = "overdue"
            message = (
                f"{entry['mode']} {entry['id']!r} landed at {float(now):.6f}s, "
                f"target {float(target):.6f}s (late by {float(latency):.6f}s)"
            )
            self.errors.append(message)
            raise NarrationSyncError(message)
        return entry

    def _record_overdue(
        self, name: str, mode: str, target: Fraction, now: Fraction
    ) -> None:
        entry = self._entry(name, mode, target)
        entry.update(
            {
                "status": "overdue",
                "actualTime": float(now),
                "actualFrame": int(self.scene.frame),
                "actualFrameTime": int(self.scene.frame) / self.fps,
                "latencySeconds": float(now - target),
                "latencyFrames": int(self.scene.frame) - int(entry["targetFrame"]),
                "visualLatencySeconds": (int(entry["targetFrame"]) / self.fps)
                - float(target),
                "clock": [now.numerator, now.denominator],
            }
        )
        self.cue_reports.append(entry)
        message = (
            f"{mode}: scene is already at {float(now):.6f}s when cue {name!r} "
            f"targets {float(target):.6f}s (late by {float(now - target):.6f}s)"
        )
        self.errors.append(message)
        raise NarrationSyncError(message)

    # ── public scene methods ─────────────────────────────────────────────────
    def cue(self, name: str) -> None:
        """Hold the scene until the cue's absolute audio time, then return."""
        target = self.target(name, "cue")
        started = self.now
        self.used[name] = self.used.get(name, 0) + 1
        if started > target + EPS:
            self._record_overdue(name, "cue", target, started)
        entry = self._entry(name, "cue", target)
        delta = target - started
        if delta > EPS:
            self.scene.wait(delta)
        self._finish_entry(entry, target, {"call": self.used[name]})

    def play_until(self, next_cue: str, *animations: Any, **options: Any) -> None:
        """Continue a mathematical motion throughout the budget until the next cue."""
        self._animate_until(next_cue, animations, options, reveal=False)

    def reveal_until(self, next_cue: str, *animations: Any, **options: Any) -> None:
        """Reveal at the current cue, then hold until the next one; never stretch a reveal."""
        self._animate_until(next_cue, animations, options, reveal=True)

    def _animate_until(
        self, next_cue: str, animations: tuple[Any, ...], options: dict[str, Any], *, reveal: bool
    ) -> None:
        mode = "reveal_until" if reveal else "play_until"
        if "run_time" in options:
            message = (
                f"{mode} sets run_time from the cue budget; do not pass run_time"
            )
            self.errors.append(message)
            raise NarrationSyncError(message)
        if not animations:
            message = f"{mode} needs at least one animation"
            self.errors.append(message)
            raise NarrationSyncError(message)
        target = self.target(next_cue, mode)
        started = self.now
        self.used[next_cue] = self.used.get(next_cue, 0) + 1
        if started > target + EPS:
            self._record_overdue(next_cue, mode, target, started)
        budget = target - started
        if budget <= EPS:
            self._record_no_budget(next_cue, target, started, mode)
        if not reveal and budget > REVEAL_SECONDS:
            # Entrances/exits must be readable promptly, even when mixed with motion.
            # Check inheritance so custom FadeIn/FadeOut subclasses obey the same rule.
            fades = [type(animation).__name__ for animation in animations
                     if any(base.__name__ in {"FadeIn", "FadeOut"}
                            for base in type(animation).__mro__)]
            if fades:
                message = (
                    f"play_until: {', '.join(fades)} would span {float(budget):.3f}s; "
                    "use reveal_until for short reveals and holds, or establish labels "
                    "with self.add before continuous mathematical motion"
                )
                self.errors.append(message)
                raise NarrationSyncError(message)
        entry = self._entry(next_cue, mode, target)
        entry["playStart"] = float(started)
        duration = min(REVEAL_SECONDS, budget) if reveal else budget
        entry["runTime"] = float(duration)
        # Scene.play copies options onto every top-level animation. The exact Fraction
        # budget keeps GX's clock on the audio target instead of accumulating floats.
        self.scene.play(*animations, run_time=duration, **options)
        play_end = self.now
        if target > play_end:
            self.scene.wait(target - play_end)
        self._finish_entry(
            entry,
            target,
            {"call": self.used[next_cue], "playEnd": float(play_end),
             "holdSeconds": float(max(Fraction(0), target - play_end))},
        )

    def narration_end(self) -> None:
        """Wait out the audio tail; a scene already past the audio only records it."""
        before = self.now
        remaining = self.audio_duration - before
        if remaining > EPS:
            self.scene.wait(remaining)
            status = "padded"
            waited = float(self.audio_duration - before)
        else:
            status = "reached" if abs(float(remaining)) <= float(EPS) else "scene_ahead"
            waited = 0.0
        after = self.now
        self.endings.append(
            {
                "audioDuration": float(self.audio_duration),
                "before": float(before),
                "after": float(after),
                "waited": waited,
                "status": status,
            }
        )
        if status == "scene_ahead":
            self.warnings.append(
                f"scene ends at {float(before):.6f}s, after audio {float(self.audio_duration):.6f}s"
            )

    # ── render integration ───────────────────────────────────────────────────
    def on_play(self, play: Any, animations: tuple[Any, ...]) -> None:
        """GX play hook: keep every play's exact span for the report."""
        where = play.where
        self.plays.append(
            {
                "index": int(play.index),
                "start": float(play.start),
                "end": float(play.end),
                "where": None if where is None else [str(where[0]), int(where[1])],
                "animations": [type(animation).__name__ for animation in animations],
            }
        )

    def finish(self, film: Any = None, output_path: str | Path | None = None) -> None:
        self._finished = True
        self._film = film
        if output_path is not None:
            self.output_path = Path(output_path)

    def fail(self, error: BaseException) -> None:
        message = f"{type(error).__name__}: {error}"
        if message not in self.errors:
            self.errors.append(message)

    def report(self) -> dict[str, Any]:
        used = set(self.used)
        unused = sorted(set(self.cues) - used)
        tail = self.endings[-1] if self.endings else None
        film = getattr(self, "_film", None)
        frame_count = None if film is None else int(getattr(film, "frame_count", 0))
        scene_duration = None if self.scene is None else float(self.scene.clock)
        final_seconds = None if frame_count is None else frame_count / self.fps
        if (
            final_seconds is not None
            and self.audio_duration
            and final_seconds + 1 / self.fps < float(self.audio_duration)
        ):
            if not self._short_video_warned:
                self.warnings.append(
                    f"video has {frame_count} frames ({final_seconds:.6f}s), shorter than audio "
                    f"{float(self.audio_duration):.6f}s"
                )
                self._short_video_warned = True
        return {
            "version": VERSION,
            "status": "error" if self.errors else "ok",
            "manifestPath": str(self.manifest_path),
            "audioPath": None if self.audio_path is None else str(self.audio_path),
            "outputPath": None if self.output_path is None else str(self.output_path),
            "audioDuration": float(self.audio_duration),
            "fps": self.fps,
            "sceneDuration": scene_duration,
            "frameCount": frame_count,
            "videoDuration": final_seconds,
            "cues": self.cue_reports,
            "unusedCues": unused,
            "endings": self.endings,
            "tail": tail,
            "warnings": self.warnings,
            "errors": self.errors,
            "plays": self.plays,
        }

    def write_report(self, report_path: str | Path) -> None:
        _atomic_json(Path(report_path), self.report())


__all__ = [
    "NarrationError",
    "NarrationManifestError",
    "NarrationRuntime",
    "NarrationSyncError",
    "write_error_report",
]
