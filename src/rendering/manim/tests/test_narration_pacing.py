"""Regression coverage for reveal/hold versus continuous narration motion."""
import importlib.util
import json
import math
from fractions import Fraction
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "narration_runtime", Path(__file__).resolve().parents[1] / "narration_runtime.py"
)
runtime_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime_module)


class ClockScene:
    def __init__(self):
        self.clock = Fraction(0)
        self.calls = []

    @property
    def frame(self):
        return math.ceil(self.clock * 60)

    def construct(self):
        pass

    def play(self, *animations, run_time, **options):
        self.calls.append(("play", self.clock, run_time))
        self.clock += run_time

    def wait(self, duration):
        self.calls.append(("wait", self.clock, duration))
        self.clock += duration


class FadeIn:
    pass


class CustomFade(FadeIn):
    pass


class PacingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        (root / "audio.wav").touch()
        manifest = root / "manifest.json"
        manifest.write_text(json.dumps({
            "version": 1, "audioPath": "audio.wav", "duration": 20,
            "cues": {"short": 0.2, "long": 17.2315}, "segments": []
        }), encoding="utf-8")
        self.runtime = runtime_module.NarrationRuntime(manifest, 60)
        self.scene = ClockScene()
        self.runtime.attach(self.scene)

    def test_long_reveal_finishes_promptly_then_holds_to_exact_cue(self):
        self.scene.reveal_until("long", FadeIn())
        self.assertEqual(self.scene.calls, [
            ("play", Fraction(0), Fraction(3, 5)),
            ("wait", Fraction(3, 5), Fraction("16.6315"))
        ])
        self.assertEqual(self.scene.clock, Fraction("17.2315"))
        report = self.runtime.cue_reports[-1]
        self.assertEqual(report["latencySeconds"], 0)
        self.assertEqual(report["playEnd"], 0.6)
        self.assertEqual(report["mode"], "reveal_until")

    def test_short_reveal_fits_available_budget_without_overshoot(self):
        self.scene.reveal_until("short", FadeIn())
        self.assertEqual(self.scene.calls, [("play", Fraction(0), Fraction(1, 5))])
        self.assertEqual(self.runtime.cue_reports[-1]["holdSeconds"], 0)

    def test_continuous_motion_keeps_full_budget(self):
        self.scene.play_until("long", object())
        self.assertEqual(self.scene.calls, [("play", Fraction(0), Fraction("17.2315"))])

    def test_long_fades_including_subclasses_fail_before_playback(self):
        for animation in (FadeIn(), CustomFade()):
            with self.assertRaisesRegex(runtime_module.NarrationSyncError, "use reveal_until"):
                self.scene.play_until("long", object(), animation)
        self.assertEqual(self.scene.calls, [])

    def test_unknown_overdue_and_zero_budget_still_fail(self):
        with self.assertRaisesRegex(runtime_module.NarrationSyncError, "unknown cue"):
            self.scene.reveal_until("unknown", FadeIn())
        self.scene.clock = Fraction(1)
        with self.assertRaisesRegex(runtime_module.NarrationSyncError, "already at"):
            self.scene.reveal_until("short", FadeIn())
        self.scene.clock = Fraction("17.2315")
        with self.assertRaisesRegex(runtime_module.NarrationSyncError, "no time left"):
            self.scene.reveal_until("long", FadeIn())

    def test_callers_cannot_override_managed_duration(self):
        with self.assertRaisesRegex(runtime_module.NarrationSyncError, "do not pass run_time"):
            self.scene.reveal_until("long", FadeIn(), run_time=10)


if __name__ == "__main__":
    unittest.main()
