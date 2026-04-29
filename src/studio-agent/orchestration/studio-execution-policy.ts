import type { StudioAgentType, StudioKind } from '../domain/types'

/**
 * Studio 执行策略接口
 * 定义不同 Studio 类型（Manim/Plot）的执行规则和行为
 */
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

/**
 * Manim Studio 执行策略
 * 用于基于场景的动画和渲染工作流
 */
const MANIM_POLICY: StudioExecutionPolicy = {
  studioLabel: 'Manim Studio',
  runtimeSummary: 'render 工具执行 Manim，生成动画或图片。',
  builderRules: [
    'Manim Studio 用于场景动画和渲染工作流。',
    '按场景、时间轴、转场、素材、渲染成本来思考。',
    '渲染前确保目标 Manim 代码已存在于工作目录，或已在 render 请求中准备好。',
    '如果场景流程、素材、渲染模式或目标文件不明确，先问再渲染。',
  ],
  builderContinueText: '延续当前正在进行的子代理工作。',
  builderTaskIntentText: (subagentType, skillName) => {
    const skillSegment = skillName ? `，使用 skill「${skillName}」` : ''
    return `将交给 ${subagentType} 子代理处理${skillSegment}。`
  },
  builderDirectToolText: (toolName) => `先使用 ${toolName} 工具。`,
  builderNoPlanText: (explicitCommand) => (
    explicitCommand
      ? '该指令在 Manim Studio 中没有匹配的自动规划路径。'
      : '该输入在 Manim Studio 中没有触发自动规划路径。'
  ),
  builderReminderTexts: {
    runningWork: (title) => `当前会话存在进行中的 Work：${title}`,
    failedRender: '最近一次 render 结果失败，请先确认失败原因再尝试。',
    unsupportedTools: (toolNames) => `自动规划暂不支持这些工具：${toolNames.join(', ')}`,
    pendingEvents: (summaries) => `待处理的后端更新：${summaries.join(' | ')}`
  },
  subagentLeadText: {
    reviewer: '将从 Manim 角度审查行为、渲染风险和代码正确性。',
    designer: '将拆解为 Manim 导向的设计方案，包含场景结构和实现步骤。'
  }
}

/**
 * Plot Studio 执行策略
 * 用于静态绘图和图形生成工作流
 */
const PLOT_POLICY: StudioExecutionPolicy = {
  studioLabel: 'Plot Studio',
  runtimeSummary: 'render 工具执行 matplotlib Python 代码，生成静态图表。write/edit/apply_patch 完成后自动触发 render。',
  builderRules: [
    'Plot Studio 用于静态绘图和图表生成工作流。',
    '不要在这里规划动画时间轴、场景编排或动效设计。',
    '渲染前确保目标 matplotlib 代码已存在于工作目录，或已在 render 请求中准备好。',
    '如果图表类型、数据源、子图布局、坐标轴、标签或输出目标不明确，先问再渲染。',
  ],
  builderContinueText: '延续当前正在进行的子代理工作。',
  builderTaskIntentText: (subagentType, skillName) => {
    const skillSegment = skillName ? `，使用 skill「${skillName}」` : ''
    return `将交给 ${subagentType} 子代理处理${skillSegment}。`
  },
  builderDirectToolText: (toolName) => `先使用 ${toolName} 工具。`,
  builderNoPlanText: (explicitCommand) => (
    explicitCommand
      ? '该指令在 Plot Studio 中没有匹配的自动规划路径。'
      : '该输入在 Plot Studio 中没有触发自动规划路径。'
  ),
  builderReminderTexts: {
    runningWork: (title) => `当前会话存在进行中的 Work：${title}`,
    failedRender: '最近一次 render 结果失败，请先确认失败原因再尝试。',
    unsupportedTools: (toolNames) => `自动规划暂不支持这些工具：${toolNames.join(', ')}`,
    pendingEvents: (summaries) => `待处理的后端更新：${summaries.join(' | ')}`
  },
  subagentLeadText: {
    reviewer: '将从 Plot Studio 角度审查绘图正确性、可复现性和输出安全性。',
    designer: '将拆解为绘图方案，包含图表结构、数据需求和实现步骤。'
  }
}

/**
 * 获取指定 Studio 类型的执行策略
 * @param studioKind - Studio 类型（'manim' 或 'plot'）
 * @returns 对应的执行策略对象
 */
export function getStudioExecutionPolicy(studioKind: StudioKind = 'manim'): StudioExecutionPolicy {
  return studioKind === 'plot' ? PLOT_POLICY : MANIM_POLICY
}



