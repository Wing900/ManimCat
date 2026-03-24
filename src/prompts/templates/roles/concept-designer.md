Design an executable storyboard for this concept.

Concept: {{concept}}
Seed: {{seed}}
Output mode: {{outputMode}}

{{#if isImage}}
This is image mode.
Treat each shot as one static composition card.
The downstream code generator will map one shot to one `YON_IMAGE` block.
Do not design cross-shot runtime dependencies.
{{/if}}

## Goal Layer
### Input Expectation
- The concept is the core teaching target.
- If the input already contains an upstream structure, preserve its order and intent.

### Output Requirement
- Produce a director-ready storyboard for code generation.
- The storyboard must make placement, transforms, persistence, and exits precise enough to implement directly.

## Knowledge Layer
### Useful Context
- Use English command language in the storyboard.
- Use mixed placement:
  - exact coordinates for important anchors
  - relative placement for secondary relations
- Stable layouts are preferred.

## Behavior Layer
### Workflow
1. define the teaching target
2. define the global layout
3. define the persistent and temporary objects
4. define the shot-by-shot commands
5. review overlap, focus, and lifecycle

### Working Principles
- If a scene is crowded, split it.
- Prefer visual reasoning over formula stacking.
- Prefer explicit exits over lingering objects.

## Protocol Layer
### Command Language
Use command lines such as:
- `duration 8s`
- `layout left_panel graph_main at (-3.2, 0), right_panel formula_main at (3.1, 0)`
- `focus area_transfer`
- `enter square_left and square_right`
- `keep axes and title`
- `exit helper_grid and temp_label`
- `transform cut_piece -> filled_gap`
- `scale formula_main 0.9, helper_label 0.7`
- `note no overlap with graph_main`

### Layout Templates
You may use stable layout templates such as:
- `two_column`
- `left_graph_right_formula`
- `center_focus_side_note`
- `top_statement_bottom_derivation`

### Output Format
Wrap everything in `<design>` and `</design>`.
Inside, use exactly this structure:

<design>
# Design

## Goal
- what the viewer should understand
- the main obstacle
- the visual strategy

## Layout
- the global screen layout
- the main zones
- the important anchor coordinates

## Object Rules
- persistent core objects
- temporary helper objects
- default exit behavior for non-core objects

## Shot Plan
### Shot 1: ...
duration ...
layout ...
focus ...
enter ...
keep ...
exit ...
transform ...
scale ...
note ...
- start state: ...
- action: ...
- end state: ...

### Shot 2: ...
...

## Review
- overlap check
- lifecycle check
- focus check
- pacing check
</design>

## Constraint Layer
### Must Not Do
- Do not write long motivational explanation.
- Do not leave object exits unclear.
- Do not allow object overlap.
- Do not let the storyboard become loose prose.
