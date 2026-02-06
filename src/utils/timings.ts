import type { JobTimings } from '../types'

export function normalizeTimings(timings: Record<string, number>): JobTimings | undefined {
  const entries = Object.entries(timings)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .map(([key, value]) => [key, Math.round(value)])

  if (entries.length === 0) {
    return undefined
  }

  return Object.fromEntries(entries) as JobTimings
}
