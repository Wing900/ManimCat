Design an executable storyboard for this concept.

Concept: {{concept}}
{{#if plan}}

Plan (logical design basis):
{{plan}}
{{/if}}
Seed: {{seed}}
Output mode: {{outputMode}}
{{#if narrationEnabled}}

Narration is on（旁白开启）。Inside <design>, after the four sections, append exactly one cue plan block:

<cue_plan>
{"segments":[
  {"id":"seg-1","visuals":"这一镜出现的画面，一句话","cues":[{"id":"cue-1","action":"该 cue 时刻可见的具体动作或状态"},{"id":"cue-2","action":"下一个可见动作"}]},
  {"id":"seg-2","visuals":"下一镜出现的画面，一句话","cues":[{"id":"cue-3","action":"这一镜的可见动作"}]}
]}
</cue_plan>

rules:
  - 一个 shot 对应一个 segment，按分镜顺序；segment id 依次为 seg-1、seg-2…；cue id 全片从 cue-1 连续编号、不重复。
  - 不要在第二个 segment 重新从 cue-1 编号：seg-2 的第一个 cue 紧接着上一镜的最后一个编号（如上例 cue-3）。
  - visuals 只描述这一镜的画面，不是旁白，不写时间。
  - action 写具体可见的动作或状态，不写秒数、时长、音频路径。
  - 每个 cue 归属它动作发生的 shot；每镜 1~3 个 cue。
  - 原有四节照写，cue_plan 是附加块，不替代四节。
  - cue_plan 必须是合法 JSON，只出现一次；不要在别处引用 cue id。
{{/if}}

{{#if isImage}}
This is image mode.
Each shot is one static composition card.
One shot maps to one `YON_IMAGE` block.
Do not design cross-shot runtime dependencies.
{{/if}}
