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

旁白同步已开启。运行器会在当前 Scene 实例上注入以下方法。不要 import 任何旁白模块，不要写死秒数、fps、音频路径或 manifest：
- self.cue("cue-id")：等待画面推进到该 cue 的绝对音频时间，然后继续。在该 cue 的动作开始前调用一次。
- self.reveal_until("next-cue-id", *animations)：在当前 cue 快速完成揭示，然后保留结果直到下一个 cue。用于文字、公式、标签的淡入淡出、强调和切换；运行时控制短动画与停留，不要自己传 run_time。
- self.play_until("next-cue-id", *animations)：让连续的数学运动持续到下一个 cue，例如动点运动、参数变化、轨迹变形。不要自己传 run_time。
- self.narration_end()：等待旁白音轨结束。在场景结束前调用一次。

rules:
  - 只使用下方 cue 计划中的 id，按计划顺序引用每个 cue；不得增删、改名或猜时间。
  - 开场先用 self.add 建立理解首句所需的基础画面。首个 cue 紧接旁白开头；不要等待后面的 cue 才显示首句已经提及的对象。
  - 用 self.cue(id) 等待时刻。静态信息揭示使用 self.reveal_until；连续数学运动使用 self.play_until。不要把文字或公式的 FadeIn/FadeOut 混进长时间运动，导致整段讲解都看不清；可先 self.add 建立说明，再播放运动。不要在两个 cue 之间用普通 self.play 消耗掉整段时间。
  - 不要改数学动画的 rate_func 去硬塞语音：该 linear 的仍用 linear，该 smoothstep 3t²−2t³ 的仍用 smoothstep。
  - 每个 cue 处的可见动作必须与对应 action 一致；cue 预算由运行时从 manifest 读取。
  - 先确定画面与数学过程，再把 cue 调用放在正确位置；不要等 TTS 的数字才写代码。

cue 计划：
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
