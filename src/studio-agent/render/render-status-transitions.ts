import type { StudioRenderStatus } from '../domain/core-types'

/**
 * Statuses a Render may still move forward from (task 11C1M).
 *
 * A Render lifecycle is one-directional: `queued` and `running` are the states a render result
 * bridge may still write, and `completed` / `failed` / `cancelled` are final, so a late "Bull says
 * active" observation can never resurrect a render that already finished.
 */
export const STUDIO_RENDER_ACTIVE_STATUSES: readonly StudioRenderStatus[] = ['queued', 'running']

/** Statuses a Render can never leave. */
export const STUDIO_RENDER_TERMINAL_STATUSES: readonly StudioRenderStatus[] = [
  'completed',
  'failed',
  'cancelled'
]

/** Forward-only rank of the render lifecycle; a transition must strictly increase it. */
const STUDIO_RENDER_STATUS_RANK: Readonly<Record<StudioRenderStatus, number>> = {
  queued: 0,
  running: 1,
  completed: 2,
  failed: 2,
  cancelled: 2
}

export function isStudioRenderTerminalStatus(status: StudioRenderStatus): boolean {
  return STUDIO_RENDER_TERMINAL_STATUSES.includes(status)
}

export function isStudioRenderActiveStatus(status: StudioRenderStatus): boolean {
  return STUDIO_RENDER_ACTIVE_STATUSES.includes(status)
}

/**
 * Single source of truth for the conditional write a render reconciliation may perform.
 *
 * - `from` must be non-empty and every allowed source status must still be active
 *   (`queued`/`running`), so a terminal render is never rewritten by a late observation;
 * - the target must be strictly further along the lifecycle than every source, so a render never
 *   moves backwards (`running` is never demoted to `queued` by a retry observation).
 */
export function canTransitionStudioRenderStatus(
  from: readonly StudioRenderStatus[],
  to: StudioRenderStatus
): boolean {
  if (from.length === 0) {
    return false
  }
  return from.every(
    (status) =>
      isStudioRenderActiveStatus(status) &&
      STUDIO_RENDER_STATUS_RANK[to] > STUDIO_RENDER_STATUS_RANK[status]
  )
}
