Design an executable storyboard for this concept.

Concept: {{concept}}
{{#if plan}}

Plan (logical design basis):
{{plan}}
{{/if}}
Seed: {{seed}}
Output mode: {{outputMode}}
{{#if narrationEnabled}}

Narration is enabled. Inside <design>, after the four sections, append exactly one cue plan block:

<cue_plan>
{"segments":[
  {"id":"seg-1","visuals":"what this shot shows, one sentence","cues":[{"id":"cue-1","action":"concrete visible action or state at this cue"},{"id":"cue-2","action":"next visible action"}]},
  {"id":"seg-2","visuals":"what the next shot shows, one sentence","cues":[{"id":"cue-3","action":"visible action in this shot"}]}
]}
</cue_plan>

rules:
  - One segment per shot, in storyboard order. Segment ids are seg-1, seg-2, ...; cue ids are numbered continuously cue-1, cue-2, ... and unique across the whole plan.
  - Do not restart numbering in the second segment: seg-2's first cue continues after the previous shot's last cue (cue-3 above).
  - visuals describes this shot only; it is not narration and has no timing.
  - action is a concrete visible action or state: no seconds, durations or audio paths.
  - Each cue belongs to the shot where its action happens; use 1-3 cues per shot.
  - Keep the four sections unchanged. cue_plan is additional, not a replacement.
  - The block must be valid JSON, appear once, and cue ids must not be referenced elsewhere.
{{/if}}

{{#if isImage}}
This is image mode.
Each shot is one static composition card.
One shot maps to one `YON_IMAGE` block.
Do not design cross-shot runtime dependencies.
{{/if}}
