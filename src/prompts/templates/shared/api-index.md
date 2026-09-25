## ManimCE Core

- Only use APIs from the installed Manim Community Edition runtime; never substitute APIs from similarly named frameworks.
- `Scene.play()` accepts `Animation` objects or `.animate` builders: use `self.play(mob.animate.shift(...))`, not `self.play(mob.shift(...))`.
- Read position with `mob.get_center()`; `mob.center()` moves the object to `ORIGIN`.
- Use `set_width/height`, `scale_to_fit_width/height`, or `stretch_to_fit_width/height`; `stretch_to_fit(width=..., height=...)` does not exist.
- `set_z_index()` controls z-order; `bring_to_front/back()` reorders scene mobjects and is not an animation.
- In `MovingCameraScene`, animate `self.camera.frame` to move or zoom; do not invent `self.camera.set_zoom()`.
- `MathTex` has no `compile_latex()`; use `VGroup(...).arrange(DOWN)` for vertical layout.
