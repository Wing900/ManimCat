import type { JobTimings } from '../../types'

const STAGE_KEYS = ['queue', 'analyze', 'generate', 'edit', 'retry', 'render', 'mux', 'store'] as const

export function totalTimings(timings: Record<string, number>): number {
  return STAGE_KEYS.reduce((total, key) => total + (timings[key] || 0), 0)
}

export function normalizeTimings(timings: Record<string, number>): JobTimings | undefined {
  const entries = Object.entries(timings)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .map(([key, value]) => [key, Math.round(value)])

  if (entries.length === 0) {
    return undefined
  }

  return Object.fromEntries(entries) as JobTimings
}
