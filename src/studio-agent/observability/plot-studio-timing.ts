import { createLogger } from '../../utils/logger'

const logger = createLogger('PlotStudioTiming')

export function isPlotStudioKind(studioKind?: string | null): boolean {
  return studioKind === 'plot'
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

  logger[level](event, data)
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
