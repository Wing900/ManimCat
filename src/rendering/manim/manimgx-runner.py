"""ManimCat's native ManimGX entry point for MP4 and clean final-frame PNG output.

Keep the engine integration here; queueing, cancellation and deadlines belong to
the parent process. Scene files are loaded without rewriting their source.
"""

import argparse
import importlib.util
import linecache
import sys
from pathlib import Path
from time import perf_counter


def load_scene(source: Path, name: str | None, scene_base: type) -> type:
    spec = importlib.util.spec_from_file_location(source.stem, source)
    if spec is None:
        raise ValueError(f"Cannot load scene file: {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    sys.path.insert(0, str(source.parent))
    # Compile the current source directly: retry edits must never reuse bytecode.
    text = source.read_text(encoding="utf-8-sig")
    linecache.cache[str(source)] = (len(text), None, text.splitlines(True), str(source))
    exec(compile(text, str(source), "exec"), module.__dict__)
    # Imported Scene classes are helpers, not entry points defined by this file.
    candidates = {
        key: value
        for key, value in vars(module).items()
        if isinstance(value, type)
        and value is not scene_base
        and issubclass(value, scene_base)
        and value.__module__ == module.__name__
    }
    if name is not None:
        if name in candidates:
            return candidates[name]
        raise ValueError(
            f"{source.name} has no scene {name!r}. Available scenes: "
            + (", ".join(candidates) or "none")
        )
    if "MainScene" in candidates:
        return candidates["MainScene"]
    # Multiple bindings of the same class still describe one scene.
    unique = list(dict.fromkeys(candidates.values()))
    if len(unique) == 1:
        return unique[0]
    if not unique:
        raise ValueError(f"{source.name} defines no manimgx.Scene subclass")
    raise ValueError(
        f"{source.name} defines multiple scenes; select one with --scene: "
        + ", ".join(candidates)
    )


def render_png(scene, output: Path, size: tuple[int, int]) -> None:
    from PIL import Image

    finished = False
    pixels = None
    tear_down = scene.tear_down

    def finish() -> None:
        nonlocal finished
        tear_down()
        finished = True

    def capture(frame) -> None:
        nonlocal pixels
        # GX sends a closing frame after tear_down. Draw only that final state;
        # earlier animation frames are evaluated without GPU readbacks.
        if finished:
            pixels = frame.pixels()

    scene.tear_down = finish
    scene.render(frames=capture)
    if pixels is None:
        raise RuntimeError("ManimGX completed without a final frame")
    Image.frombytes("RGBA", size, pixels).save(output)


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def main() -> None:
    if sys.version_info < (3, 13):
        raise RuntimeError("ManimGX requires Python 3.13+. Set MANIMGX_PYTHON to the rendering venv's Python.")

    import manimgx as m

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--scene")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--format", required=True, choices=("mp4", "png"))
    parser.add_argument("--width", required=True, type=positive_int)
    parser.add_argument("--height", required=True, type=positive_int)
    parser.add_argument("--fps", required=True, type=positive_int)
    args = parser.parse_args()
    if args.format == "mp4" and (args.width % 2 or args.height % 2):
        parser.error("MP4 dimensions must be even")
    output = args.output.resolve()
    if output.suffix != f".{args.format}":
        parser.error("output extension must match --format")
    output.parent.mkdir(parents=True, exist_ok=True)
    # A failed retry must not leave an earlier successful artifact at this path.
    output.unlink(missing_ok=True)

    started = perf_counter()
    kind = load_scene(args.source.resolve(), args.scene, m.Scene)
    # Request settings override source config before the camera is constructed.
    m.config.pixel_width, m.config.pixel_height = args.width, args.height
    m.config.frame_rate = args.fps
    scene = kind()
    try:
        if args.format == "png":
            render_png(scene, output, (args.width, args.height))
        else:
            # Match the upstream speed benchmark's encoder settings. No storyboard
            # is generated as a side effect of a production render.
            film = scene.render(str(output), preset="ultrafast", crf=23)
            subtitles = film.subtitles()
            if subtitles:
                output.with_suffix(".srt").write_text(subtitles, encoding="utf-8")
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"ManimGX produced no {args.format.upper()} output")
    print(f"ManimGX: {output} (rendered in {perf_counter() - started:.3f}s)", flush=True)


if __name__ == "__main__":
    main()
