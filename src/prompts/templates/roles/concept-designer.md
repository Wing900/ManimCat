Design a teaching storyboard in which the spoken route and the visual evidence explain the same ideas.

Concept: {{concept}}
{{#if plan}}
Plan:
{{plan}}
{{/if}}
Seed: {{seed}}
Output mode: {{outputMode}}

每镜先确定理解目标，再安排视觉证据。完整推导写在画面中，有旁白时草稿只说主要步骤与用途，必要符号写成中文读法，保留对象的准确指代。按四节结构输出，保留用户的布局要求与完整 Plan。
{{#if narrationEnabled}}

在 design 块的四节之后附加一个 cue_plan，结构如下：
<cue_plan>
{"segments":[
  {"id":"seg-1","visuals":"这一镜出现的画面，一句话","teaching":{"learningGoal":"学生在这一镜要理解的具体关系","narrationDraft":"面向学生、解释这一关系的口语草稿，不含cue标记","visualEvidence":"画面中哪项证据支持这一解释"},"cues":[{"id":"cue-1","meaning":"此刻要理解的对象或关系","action":"支持这一含义的具体可见动作或状态"},{"id":"cue-2","meaning":"接下来要理解的变化或结论","action":"支持该含义的下一个可见变化"}]},
  {"id":"seg-2","visuals":"下一镜出现的画面，一句话","teaching":{"learningGoal":"下一层理解目标","narrationDraft":"继续解释的口语草稿，不含cue标记","visualEvidence":"本镜支持理解的可见证据"},"cues":[{"id":"cue-3","meaning":"本镜锚点支持的讲解含义","action":"这一镜的可见动作"}]}
]}
</cue_plan>

字段职责：
  - visuals 描述可见内容。teaching 中的 learningGoal、narrationDraft、visualEvidence 分别保存理解目标、步骤讲解草稿和画面证据，与对应镜头一致。
  - cue.meaning 保存此刻要理解的含义，cue.action 保存支持它的可见变化。先确定含义，再安排动作。
  - 第一个 cue 建立首句所需的基础画面与对象，其含义覆盖讲解开头；后续 cue 再引入变化。明确区分快速揭示后停留阅读与持续数学运动。
  - segment 与镜头一一对应，依次编号 seg-1、seg-2…；cue 从 cue-1 开始全片连续编号且唯一。cue id 只出现在此 JSON 中。
  - 默认全片约90秒、8~10镜；每镜0~2个必要锚点。节奏围绕理解台阶安排，讲解后留阅读时间，实际时间由语音确定。
  - 有 cue 的段给出一两句完整的步骤讲解草稿，不含锚点标记。无 cue 的段保留无旁白设计，草稿为空字符串。
  - cue_plan 为合法 JSON，仅出现一次。字段中只保存内容与含义，不写音频路径或秒数。
{{/if}}

{{#if isImage}}
This is image mode. Each shot is one static composition card and maps to one YON_IMAGE block. Keep each card self-contained.
{{/if}}
