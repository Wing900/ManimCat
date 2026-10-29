Design a teaching storyboard in which the spoken route and the visual evidence explain the same ideas.

Concept: {{concept}}
{{#if plan}}
Plan:
{{plan}}
{{/if}}
Seed: {{seed}}
Output mode: {{outputMode}}

Establish each shot's learning goal before choosing its visual evidence. Keep the complete derivation in the visuals; narrated drafts cover only the main steps and their purposes. Use the four-section structure, preserving the user's layout requirements and the full Plan.
{{#if narrationEnabled}}

Append one cue_plan after the four sections inside design, using this structure:
<cue_plan>
{"segments":[
  {"id":"seg-1","visuals":"what this shot shows, one sentence","teaching":{"learningGoal":"the specific relationship the learner should understand","narrationDraft":"student-facing spoken explanation without cue markers","visualEvidence":"what visible evidence supports this explanation"},"cues":[{"id":"cue-1","meaning":"the object or relationship being explained here","action":"the visible action or state supporting that meaning"},{"id":"cue-2","meaning":"the next change or conclusion being explained","action":"the next visible change supporting it"}]},
  {"id":"seg-2","visuals":"what the next shot shows, one sentence","teaching":{"learningGoal":"the next step of understanding","narrationDraft":"the continuing spoken explanation without cue markers","visualEvidence":"the visible evidence supporting this step"},"cues":[{"id":"cue-3","meaning":"the explanation this anchor supports","action":"visible action in this shot"}]}
]}
</cue_plan>

The first cue establishes the basic picture and objects needed by the first sentence; later cues introduce changes. Distinguish prompt reveals followed by reading time from sustained mathematical motion.

Field responsibilities:
  - visuals describes visible content. teaching.learningGoal, narrationDraft and visualEvidence contain the intended understanding, spoken route draft and supporting evidence, consistent with the corresponding shot.
  - cue.meaning describes the idea understood here; cue.action describes the visible change supporting it. Establish meaning before choosing an action.
  - One segment per shot, numbered seg-1, seg-2, ...; cue IDs are unique and continuous across the entire plan from cue-1. Cue IDs appear only inside this JSON.
  - By default, plan about ninety seconds across eight to ten shots with zero to two necessary anchors per shot. Pace around steps of understanding and leave reading time after speech. Actual speech determines timing.
  - Segments with cues have a complete one- or two-sentence spoken route draft without cue markers. Wordless segments have no cues and an empty draft.
  - cue_plan is valid JSON and appears once. Fields contain content and meaning, without audio paths or durations in seconds.
{{/if}}

{{#if isImage}}
This is image mode. Each shot is one static composition card and maps to one YON_IMAGE block. Keep each card self-contained.
{{/if}}
