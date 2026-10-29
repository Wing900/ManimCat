User task: {{concept}}
{{#if plan}}

Plan (logical design basis):
{{plan}}

{{/if}}
{{#if sceneDesign}}
Storyboard:

{{sceneDesign}}

{{/if}}
Seed: {{seed}}
Output mode: {{outputMode}}
{{#if narrationEnabled}}

Narration sync is enabled. The runner injects these methods on the current scene instance. Do not import a narration module and do not hardcode seconds, fps, audio paths or a manifest:
- self.cue("cue-id"): hold until this cue's absolute audio time, then continue. Call it once immediately before the action for that cue.
- self.reveal_until("next-cue-id", *animations): reveal promptly at the current cue, then hold until the next cue. Use for text, formula and label entrances/exits, emphasis and state changes. The runtime owns the short duration and hold; never pass run_time.
- self.play_until("next-cue-id", *animations): sustain continuous mathematical motion until the next cue, such as a moving point, parameter change or curve deformation. Never pass run_time yourself.
- self.narration_end(): wait for the narration track to end. Call it once before the scene finishes.

rules:
  - Use only the ids in the cue plan below, in plan order; never add, rename or guess a cue time.
  - Establish the basic picture needed to understand the first sentence with self.add before waiting. The first cue begins with the narration; never defer objects already mentioned in the opening to a later cue.
  - Use self.cue(id) to wait, self.reveal_until for static information reveals, and self.play_until for continuous mathematical motion. Keep text/formula FadeIn/FadeOut out of long motion spans; establish explanatory objects with self.add before motion when needed. Never let a normal self.play consume time across a cue boundary.
  - Do not change a math animation's rate_func to fit the voice: keep linear where linear is required and smoothstep 3t²−2t³ where smoothstep is required.
  - The visible action at each cue must match its action text; the runtime reads cue budgets from the manifest.
  - Decide the picture and the mathematics first, then place cue calls. Do not wait for TTS numbers before writing code.

Cue plan:
{{narrationCuePlan}}
{{/if}}

{{#if isVideo}}
Output format:
- Start with `### START ###`
- End with `### END ###`
- Use `from manimgx import *`
- Use `MainScene` as the main class unless true 3D is required
- On-screen text follows the user locale: all Chinese in Chinese mode, all English in English mode
{{/if}}

{{#if isImage}}
Output format:
- Output only `YON_IMAGE` anchor blocks
- Number blocks continuously from `YON_IMAGE_1` upward
- Map one storyboard shot to one block
- Each block must contain one renderable Scene
- Use `from manimgx import *`
- On-screen text follows the user locale: all Chinese in Chinese mode, all English in English mode
{{/if}}
