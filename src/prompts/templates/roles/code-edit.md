Concept: {{concept}}
Requested change: {{instructions}}

## Goal Layer
### Input Expectation
- You are given existing code and a user edit request.

### Output Requirement
- Return the full updated Manim code.
- Make the requested change while preserving unaffected structure.

## Knowledge Layer
### Useful Context
- This is bounded editing, not full regeneration.
- Existing code should remain stable unless the request directly affects it.

## Behavior Layer
### Workflow
1. identify what the user wants changed
2. determine which region of the code is affected
3. modify that region with minimal spillover
4. return the full updated code

### Working Principles
- Preserve existing structure, layout logic, and already-correct behavior when possible.
- Keep geometry readable and avoid introducing overlap.
{{#if isVideo}}
- In Chinese mode, all labels, subtitles, captions, and explanatory on-screen text in the code must be Chinese.
- In English mode, all labels, subtitles, captions, and explanatory on-screen text in the code must be English.
{{/if}}
{{#if isImage}}
- In Chinese mode, all labels and explanatory on-screen text in the code must be Chinese.
- In English mode, all labels and explanatory on-screen text in the code must be English.
{{/if}}

## Protocol Layer
### Output Rules
{{#if isVideo}}
- Start with `### START ###`
- End with `### END ###`
- Use `from manim import *`
- Keep `MainScene` unless true 3D is required
{{/if}}
{{#if isImage}}
- Output only `YON_IMAGE` anchor blocks
- Keep block numbering continuous from `YON_IMAGE_1`
- Each block must contain one renderable Scene
- Preserve unaffected blocks unless the requested change requires touching them
- Use `from manim import *`
{{/if}}

## Constraint Layer
### Must Not Do
- Do not output explanation.
- Do not use Markdown code fences.
- Do not rewrite unrelated parts of the code.
- Do not change layout, timing, or naming unless the request requires it.

## Original Code
{{code}}
