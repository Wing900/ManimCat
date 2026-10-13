## Shared Specification

### Visible Information and Motion Invariants

- On light backgrounds, explicitly set a dark base color for every `Text`, `Tex`, and `MathTex`, including operators, exponents and equality signs, before selective highlighting. Pastel geometry colors do not make white formulas legible.
- Fit captions within the screen safe area: split long sentences into timed captions or wrap lines, cap width, and preserve readable size. Never let a single long `Text` overflow horizontally.
- Derive dependent geometry from a single state variable. Constant length/area/contact constraints must hold throughout animation, not just at sampled endpoints. Do not interpolate endpoints independently when that breaks a constraint.
- When demonstrating uniform motion or equal-time sampling, animate the independent variable with `rate_func=linear`; easing and pauses change the demonstrated timing. Compute samples from the same model and timeline rather than guessed coordinates.

### Strictly Forbidden

- **No chatter**: do not add filler before or after code
- **No Markdown wrapping**: do not wrap code in Markdown fences
- **Text Rendering Rule**: do not execute Manim animations directly on raw strings. All text must first be wrapped as an Mobject. Chinese text must use `Text()` or `MarkupText()`, never `MathTex` or `Tex`.
- **No legacy syntax**: do not use `ShowCreation`, `TextMobject`, `TexMobject`, or `number_scale_val`

### Error Correction

- **Indexing trap**: never use `[i]` indexing directly on `MathTex`
- **Configuration dictionaries**: never pass visual parameters directly into `Axes`; they must be wrapped inside `axis_config`
- **Dashed-line trap**: never pass `dash_length` or `dashed_ratio` directly into common drawing helpers such as `plot()`, `Line()`, or `Circle()`

### API Strictness

- **Whitelist mechanism**: only use methods, parameters, and classes explicitly listed in the API index
- **Blacklist mechanism**: anything not mentioned in the index is forbidden by default
- **No imagination**: do not infer, guess, or invent API usages outside the index
- **Strict ownership**: `Scene` may use only methods listed under `Scene_methods`, and `ThreeDScene` may use only methods listed under `ThreeDScene_methods`. Do not mix them

### Technical Principles

- **Dynamic updates**: for processes involving changing values, prefer `ValueTracker` together with `always_redraw`
- **Formula manipulation rules**: do not use hard-coded indices. Use `substrings_to_isolate` together with `get_part_by_tex` to operate on specific formula components
- **Coordinate-system consistency**: all graphics must be mapped through `axes.c2p` onto the coordinate axes. Free positioning detached from the axis system is forbidden
- **Collision avoidance and alignment**: text, labels, and formulas must have explicit positional offsets, preferably using `next_to`, `shift`, or `buff`. Multiple text elements may not overlap in the same position
