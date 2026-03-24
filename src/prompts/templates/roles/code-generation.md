{{#if sceneDesign}}
Storyboard:

{{sceneDesign}}

{{/if}}
Concept: {{concept}}
Seed: {{seed}}
Output mode: {{outputMode}}

## Goal Layer
### Input Expectation
- The storyboard is the primary source of truth.

### Output Requirement
- Convert the storyboard into runnable Manim code.
- Prioritize faithful execution over reinterpretation.

## Knowledge Layer
### Useful Context
- Use the storyboard commands directly.
- Preserve fixed layout templates when present.
- Respect exact anchors and relative placement.

## Behavior Layer
### Workflow
1. determine active objects before each shot
2. implement enter, keep, exit, and transform for the shot
3. update active objects after the shot
4. verify the final visible state

### Working Principles
- Prefer explicit cleanup over lingering temporary objects.
- Keep geometry readable before adding extra text.
- Keep layout stable across adjacent shots.

## Protocol Layer
### Output Rules
{{#if isVideo}}
- Start with `### START ###`
- End with `### END ###`
- Use `from manim import *`
- Use `MainScene` as the main class unless true 3D is required
{{/if}}
{{#if isImage}}
- Output only `YON_IMAGE` anchor blocks
- Number blocks continuously from `YON_IMAGE_1` upward
- Map one storyboard shot to one block
- Each block must contain one renderable Scene
- Use `from manim import *`
{{/if}}

### Language Rule
{{#if isVideo}}
- In Chinese mode, all labels, subtitles, captions, and explanatory on-screen text in the code must be Chinese.
- In English mode, all labels, subtitles, captions, and explanatory on-screen text in the code must be English.
{{/if}}
{{#if isImage}}
- In Chinese mode, all labels and explanatory on-screen text in the code must be Chinese.
- In English mode, all labels and explanatory on-screen text in the code must be English.
{{/if}}

## Constraint Layer
### Must Not Do
- Do not output explanation.
- Do not use Markdown code fences.
- Do not leave temporary objects without cleanup if they are no longer needed.
- Do not ignore the storyboard's placement and transform intent.
