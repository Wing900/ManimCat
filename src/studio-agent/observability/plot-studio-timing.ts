import { createLogger } from '../../utils/logger'

const logger = createLogger('PlotStudioTiming')
const IMPORTANT_PLOT_STUDIO_EVENTS = new Set([
  'run.started',
  'run.completed',
  'run.failed',
  'loop.started',
  'provider.completed',
  'provider.failed',
  'tool.failure.detected',
])

const PLOT_STUDIO_EVENT_LABELS: Record<string, string> = {
  'http.run.requested': '绘图工作室：收到运行请求',
  'http.run.accepted': '绘图工作室：运行请求已接受',
  'provider.completed': '绘图工作室：模型请求完成',
  'provider.failed': '绘图工作室：模型请求失败',
  'step.started': '绘图工作室：模型步骤开始',
  'step.response': '绘图工作室：模型步骤返回',
  'step.finished': '绘图工作室：模型步骤结束',
  'run.started': '绘图工作室：运行开始',
  'run.completed': '绘图工作室：运行完成',
  'run.failed': '绘图工作室：运行失败',
  'loop.started': '绘图工作室：进入工具循环',
  'assistant.text': '绘图工作室：助手文本已写入',
  'tool.started': '绘图工作室：工具开始执行',
  'tool.completed': '绘图工作室：工具执行成功',
  'tool.failed': '绘图工作室：工具执行失败',
  'tool.failure.detected': '绘图工作室：检测到工具失败',
  'events.client.connected': '绘图工作室：前端事件流已连接',
  'events.client.disconnected': '绘图工作室：前端事件流已断开',
}

export function isPlotStudioKind(studioKind?: string | null): boolean {
  return studioKind === 'plot'
}

/**
 * 简洁时间线日志 — 一行一个事件，用于快速判断时间花在哪里
 * 格式：14:32:05.123 ▸ tool.started create_plot
 */
export function logTimeline(
  studioKind: string | null | undefined,
  event: string,
  detail?: string
): void {
  if (!isPlotStudioKind(studioKind)) {
    return
  }
  const ts = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
  const suffix = detail ? ` ${detail}` : ''
  console.log(`${ts} ▸ ${event}${suffix}`)
}

export function logPlotStudioTiming(
  studioKind: string | null | undefined,
  event: string,
  data: Record<string, unknown>,
  level: 'info' | 'warn' = 'info'
): void {
  if (!isPlotStudioKind(studioKind)) {
    return
  }
  if (!IMPORTANT_PLOT_STUDIO_EVENTS.has(event)) {
    return
  }

  logger[level](toChinesePlotStudioEventLabel(event), {
    事件代码: event,
    ...data,
  })
}

export function readElapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

export function readRunElapsedMs(run: { createdAt?: string }): number | null {
  if (!run.createdAt) {
    return null
  }

  const createdAt = new Date(run.createdAt).getTime()
  if (!Number.isFinite(createdAt)) {
    return null
  }

  return Math.max(0, Date.now() - createdAt)
}

function toChinesePlotStudioEventLabel(event: string): string {
  return PLOT_STUDIO_EVENT_LABELS[event] ?? `绘图工作室：${event}`
}
