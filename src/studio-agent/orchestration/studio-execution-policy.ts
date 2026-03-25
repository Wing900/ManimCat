import type { StudioAgentType, StudioKind } from '../domain/types'

export interface StudioExecutionPolicy {
  studioLabel: string
  runtimeSummary: string
  builderRules: string[]
  builderContinueText: string
  builderTaskIntentText: (subagentType: 'reviewer' | 'designer', skillName?: string) => string
  builderDirectToolText: (toolName: string) => string
  builderNoPlanText: (explicitCommand: boolean) => string
  builderReminderTexts: {
    runningWork: (title: string) => string
    failedRender: string
    unsupportedTools: (toolNames: string[]) => string
    pendingEvents: (summaries: string[]) => string
  }
  subagentLeadText: Record<Extract<StudioAgentType, 'reviewer' | 'designer'>, string>
}

const MANIM_POLICY: StudioExecutionPolicy = {
  studioLabel: 'Manim Studio',
  runtimeSummary: 'The render tool executes Manim and produces animation or image renders.',
  builderRules: [
    'Manim Studio is for scene-based animation and render workflows.',
    'Think in terms of scenes, timing, transitions, assets, and render cost.',
    'Before rendering, make sure the target Manim code exists in the workspace or is fully prepared in the render request.',
    'If the requested scene flow, assets, render mode, or target file is ambiguous, ask before rendering.'
  ],
  builderContinueText: '延续当前正在进行的子代理工作。',
  builderTaskIntentText: (subagentType, skillName) => {
    const skillSegment = skillName ? ` using skill "${skillName}"` : ''
    return `I will hand this off to the ${subagentType} subagent${skillSegment}.`
  },
  builderDirectToolText: (toolName) => `I will use the ${toolName} tool first.`,
  builderNoPlanText: (explicitCommand) => (
    explicitCommand
      ? 'That command did not match an available automatic planning path in Manim Studio.'
      : 'This input did not trigger an automatic planning path in Manim Studio.'
  ),
  builderReminderTexts: {
    runningWork: (title) => `当前会话存在进行中的 Work：${title}`,
    failedRender: '最近一次 render 结果失败，请先确认失败原因再尝试。',
    unsupportedTools: (toolNames) => `Automatic planning does not cover these requested tools yet: ${toolNames.join(', ')}.`,
    pendingEvents: (summaries) => `Pending backend updates: ${summaries.join(' | ')}`
  },
  subagentLeadText: {
    reviewer: 'I will review this with a Manim-first focus on behavior, render risk, and code correctness.',
    designer: 'I will break this into a Manim-oriented design plan with scene structure and implementation steps.'
  }
}

const PLOT_POLICY: StudioExecutionPolicy = {
  studioLabel: 'Plot Studio',
  runtimeSummary: 'The render tool executes matplotlib Python and produces static plots.',
  builderRules: [
    'Plot Studio is for static plotting and figure-generation workflows.',
    'Do not plan animation timelines, scene choreography, or motion design here.',
    'Before rendering, make sure the target matplotlib code exists in the workspace or is fully prepared in the render request.',
    'If the chart type, data source, subplot layout, axes, labels, or output target is ambiguous, ask before rendering.'
  ],
  builderContinueText: '延续当前正在进行的子代理工作。',
  builderTaskIntentText: (subagentType, skillName) => {
    const skillSegment = skillName ? ` using skill "${skillName}"` : ''
    return `I will hand this off to the ${subagentType} subagent${skillSegment}.`
  },
  builderDirectToolText: (toolName) => `I will use the ${toolName} tool first.`,
  builderNoPlanText: (explicitCommand) => (
    explicitCommand
      ? 'That command did not match an available automatic planning path in Plot Studio.'
      : 'This input did not trigger an automatic planning path in Plot Studio.'
  ),
  builderReminderTexts: {
    runningWork: (title) => `当前会话存在进行中的 Work：${title}`,
    failedRender: '最近一次 render 结果失败，请先确认失败原因再尝试。',
    unsupportedTools: (toolNames) => `Automatic planning does not cover these requested tools yet: ${toolNames.join(', ')}.`,
    pendingEvents: (summaries) => `Pending backend updates: ${summaries.join(' | ')}`
  },
  subagentLeadText: {
    reviewer: 'I will review this with a Plot Studio focus on plotting correctness, reproducibility, and output safety.',
    designer: 'I will break this into a plotting plan with figure structure, data needs, and implementation steps.'
  }
}

export function getStudioExecutionPolicy(studioKind: StudioKind = 'manim'): StudioExecutionPolicy {
  return studioKind === 'plot' ? PLOT_POLICY : MANIM_POLICY
}



