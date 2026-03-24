Concept: {{concept}}
Attempt: {{attempt}}
Error: {{errorMessage}}

## Goal Layer
### Input Expectation
- You are given the current full code.
{{#if codeSnippet}}
- You are also given an error-related snippet. Prefer to repair near it.
{{/if}}

### Output Requirement
- Return patch blocks only.
- Fix only the code directly related to the current failure.
- Preserve everything else unless the error directly forces a wider change.

## Knowledge Layer
### Useful Context
- This is local patch repair, not full regeneration.
- Minimal exact replacement is preferred.

## Behavior Layer
### Workflow
1. locate the failure
2. choose the smallest exact search snippet
3. replace only the necessary code
4. return one or more patch blocks

### Working Principles
- If a one-line fix works, do not replace a whole block.
- If several separate local failures exist, return multiple minimal patches.
- Preserve Manim structure compatibility.
- If the patch touches on-screen text, preserve the current locale language and do not introduce mixed-language text.
{{#if isVideo}}
- In video mode, preserve a renderable `MainScene`.
{{/if}}
{{#if isImage}}
- In image mode, preserve the existing `YON_IMAGE` anchor structure and continuous numbering.
- In image mode, patch the failing block as locally as possible and leave unaffected blocks unchanged.
{{/if}}

## Protocol Layer
### Output Format
Use exactly:
[[PATCH]]
[[SEARCH]]
original code snippet
[[REPLACE]]
replacement code snippet
[[END]]

### Few-Shot Example
Example:

Error:
Name "ThreeDScene" is not defined

Current code:
from manim import *

class MainScene(ThreeDScene):
    pass

Correct output:
[[PATCH]]
[[SEARCH]]
from manim import *
[[REPLACE]]
from manim import *
from manim import ThreeDScene
[[END]]

## Constraint Layer
### Must Not Do
- Do not return full code.
- Do not add explanation.
- Do not broaden the patch if a smaller one works.

## Current Full Code
{{code}}

{{#if codeSnippet}}
## Error-Related Snippet
{{codeSnippet}}
{{/if}}
