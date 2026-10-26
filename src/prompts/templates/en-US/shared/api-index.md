## ManimGX Core

- Only use APIs from the installed ManimGX runtime; its scene API is compatible with Manim Community Edition.
- Import directly from the `manimgx` package root.
- `Scene.play()` accepts `Animation` objects or `.animate` builders: use `self.play(mob.animate.shift(...))`, not `self.play(mob.shift(...))`.
- Read position with `mob.get_center()`; `mob.center()` moves the object to `ORIGIN`.
- All positions are 3D: write `(x, y, 0)`, never `(x, y)`. This applies to `move_to`, `Dot`, `Line`, `DashedLine`, `Arrow`, `Polygon`, and any point argument.
- Set size with `width = ...` / `height = ...`, `scale_to_fit_width/height`, or `stretch_to_fit_width/height`. `set_width/height` and `stretch_to_fit(width=..., height=...)` do not exist in ManimGX 0.1.1.
- `set_z_index()` controls z-order; `bring_to_front/back()` reorders scene mobjects and is not an animation.
- In `MovingCameraScene`, animate `self.camera.frame` to move or zoom; do not invent `self.camera.set_zoom()`.
- Screen captions: `ThreeDScene.add_fixed_in_frame_mobjects()` belongs to the `ThreeDScene` hierarchy; `Scene` and `MovingCameraScene` do not provide it.
- `add_foreground_mobjects()` controls draw order only; it does not lock captions to the screen. For a moving 2D camera, use a custom frame-relative position/size updater, or transform the geometry while leaving captions unchanged. Preserve caption updates during fades; check readability before, during, and after camera motion.

### Text and Math (Typst)

- Plain text: `Text("...")`. Mixed text and math: `Typst("中文 $x^2$")`. Standalone formula: `MathTypst("x^2")` with no `$`.
- Use native Typst math. Never write a LaTeX backslash command: write `pi`, `frac(a, b)`, `sqrt(x)`; never `\pi`, `\frac`, `\sqrt`.
- Multi-letter geometric labels: one-letter labels are literal; two or more consecutive letters form one identifier and must be quoted.
  Wrong: `Typst("线段 $PF$ 垂直于 $AB$")`
  Right: `Typst('线段 $"PF"$ 垂直于 $"AB"$')`
  Single-letter labels: `$P$`, `$F$`, `$x$`, `$P_i$` need no quotes. Product: `$P F$`; label: `$"PF"$`.
- Typst functions such as `sin`, `cos`, `lim`, `log` are keywords; do not quote them.
- Dollar signs: inside `Typst`, math must be wrapped in `$...$`; `MathTypst` adds the `$` signs, so pass the body without them.
  Wrong: `MathTypst("$x^2$")` (the extra `$` are rendered)
  Right: `MathTypst("x^2")`, `Typst("面积为 $x^2$")`
