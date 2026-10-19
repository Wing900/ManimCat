## ManimGX Core

- Only use APIs from the installed ManimGX runtime; its scene API is compatible with Manim Community Edition.
- Import directly from the `manimgx` package root.
- Use native Typst syntax: `MathTypst('frac(a, b)')` for formulas and `Typst('面积为 $pi r^2$')` for Chinese mixed with mathematics. `MathTypst` takes the math body without enclosing `$` signs.
- `Scene.play()` accepts `Animation` objects or `.animate` builders: use `self.play(mob.animate.shift(...))`, not `self.play(mob.shift(...))`.
- Read position with `mob.get_center()`; `mob.center()` moves the object to `ORIGIN`.
- Use `set_width/height`, `scale_to_fit_width/height`, or `stretch_to_fit_width/height`; `stretch_to_fit(width=..., height=...)` does not exist.
- `set_z_index()` controls z-order; `bring_to_front/back()` reorders scene mobjects and is not an animation.
- In `MovingCameraScene`, animate `self.camera.frame` to move or zoom; do not invent `self.camera.set_zoom()`.
- Screen captions: `ThreeDScene.add_fixed_in_frame_mobjects()` belongs to the `ThreeDScene` hierarchy; `Scene` and `MovingCameraScene` do not provide it. Use `Text()` for plain Chinese captions and `Typst()` for Chinese mixed with mathematics.
- `add_foreground_mobjects()` controls draw order only; it does not lock captions to the screen. For a moving 2D camera, use a custom frame-relative position/size updater, or transform the geometry while leaving captions unchanged. Preserve caption updates during fades; check readability before, during, and after camera motion.
