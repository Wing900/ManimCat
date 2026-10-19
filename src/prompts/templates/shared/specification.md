## Shared Specification

### Visible Information and Motion Invariants

- On light backgrounds, explicitly set a dark base color for every `Text`, `Typst`, and `MathTypst`, including operators, exponents and equality signs, before selective highlighting. Pastel geometry colors do not make white formulas legible.
- Fit captions within the screen safe area: split long sentences into timed captions or wrap lines, cap width, and preserve readable size. Never let a single long `Text` overflow horizontally.
- Derive dependent geometry from a single state variable. Constant length/area/contact constraints must hold throughout animation, not just at sampled endpoints. Do not interpolate endpoints independently when that breaks a constraint.
- When demonstrating uniform motion or equal-time sampling, animate the independent variable with `rate_func=linear`; easing and pauses change the demonstrated timing. Compute samples from the same model and timeline rather than guessed coordinates.

### Strictly Forbidden

- **No chatter**: do not add filler before or after code
- **No Markdown wrapping**: do not wrap code in Markdown fences
- **Text and Typesetting Rule**: use `Text()` for plain prose, `MathTypst()` for formulas, and `Typst()` for mixed prose and mathematics. Typst supports Chinese alongside mathematical notation, including within one `Typst()` object. Do not animate raw strings directly; wrap visible content in an Mobject.
- **No legacy syntax**: do not use `ShowCreation`, `TextMobject`, `TexMobject`, or `number_scale_val`

### Error Correction

- **Configuration dictionaries**: never pass visual parameters directly into `Axes`; they must be wrapped inside `axis_config`
- **Dashed-line trap**: never pass `dash_length` or `dashed_ratio` directly into common drawing helpers such as `plot()`, `Line()`, or `Circle()`

### API Strictness

- **Whitelist mechanism**: only use methods, parameters, and classes explicitly listed in the API index
- **Blacklist mechanism**: anything not mentioned in the index is forbidden by default
- **No imagination**: do not infer, guess, or invent API usages outside the index
- **Strict ownership**: `Scene` may use only methods listed under `Scene_methods`, and `ThreeDScene` may use only methods listed under `ThreeDScene_methods`. Do not mix them

### Technical Principles

- **Dynamic updates**: for processes involving changing values, prefer `ValueTracker` together with `always_redraw`
- **Formula selection**: when selecting a formula component, use `MathTypst('{{ a^2 : a }} + b^2 = c^2').select('a')`. Do not use `[i]`, `get_part_by_tex`, `substrings_to_isolate`, or `tex_to_color_map` with `MathTypst`.
- **Coordinate-system consistency**: all graphics must be mapped through `axes.c2p` onto the coordinate axes. Free positioning detached from the axis system is forbidden
- **Collision avoidance and alignment**: text, labels, and formulas must have explicit positional offsets, preferably using `next_to`, `shift`, or `buff`. Multiple text elements may not overlap in the same position
