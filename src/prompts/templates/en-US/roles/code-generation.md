{{#if sceneDesign}}
Storyboard:

{{sceneDesign}}

{{/if}}
Concept: {{concept}}
Seed: {{seed}}
Output mode: {{outputMode}}

{{#if isVideo}}
Output format:
- Start with `### START ###`
- End with `### END ###`
- Use `from manim import *`
- Use `MainScene` as the main class unless true 3D is required
- On-screen text follows the user locale: all Chinese in Chinese mode, all English in English mode
{{/if}}

{{#if isImage}}
Output format:
- Output only `YON_IMAGE` anchor blocks
- Number blocks continuously from `YON_IMAGE_1` upward
- Map one storyboard shot to one block
- Each block must contain one renderable Scene
- Use `from manim import *`
- On-screen text follows the user locale: all Chinese in Chinese mode, all English in English mode
{{/if}}
