import type { StudioAssetItem, StudioMessageItem, StudioTaskItem } from './types';

export const studioAssets: StudioAssetItem[] = [
  { id: 'scene-01', title: 'Scene_01_Intro', meta: '1080p | 2.4MB', state: 'ready' },
  { id: 'scene-02', title: 'Scene_02_Formula', meta: '1080p | 1.1MB', state: 'editing' },
  { id: 'scene-03', title: 'Subtitle_Draft', meta: 'Pending linkage', state: 'draft' },
];

export const studioTasks: StudioTaskItem[] = [
  { id: '702', label: 'Task #702', status: 'running', detail: 'Rendering... 72%', progress: 72 },
  { id: '701', label: 'Task #701', status: 'completed', detail: 'Completed', progress: 100 },
  { id: '700', label: 'Task #700', status: 'failed', detail: 'Failed: MathTex parse retry' },
];

export const studioMessages: StudioMessageItem[] = [
  {
    id: 'msg-user-1',
    role: 'user',
    content: '@Scene_01 给公式增加一个渐现效果，并保留原来的节奏。',
  },
  {
    id: 'msg-ai-1',
    role: 'assistant',
    content: '正在分析资产代码。我将在原始场景中插入更柔和的 Write 动画，并把这次修改挂载到新的渲染任务。',
    formula: '\\Delta S_{code} \\rightarrow \\text{Pipeline}[702]',
    code: [
      '# Increment: Apply Write Animation',
      'tex = MathTex("e^{i\\\\pi} + 1 = 0")',
      'self.play(Write(tex, run_time=2))',
    ].join('\n'),
  },
];
