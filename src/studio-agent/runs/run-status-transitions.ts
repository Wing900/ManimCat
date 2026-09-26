import type { StudioRunStatus } from '../domain/core-types'

/** Statuses a Run may still be interrupted from. */
export const STUDIO_RUN_ACTIVE_STATUSES: readonly StudioRunStatus[] = ['pending', 'running']

/** Statuses a Run can never leave: `cancelled` must not be overwritten by a late completion. */
export const STUDIO_RUN_TERMINAL_STATUSES: readonly StudioRunStatus[] = ['completed', 'failed', 'cancelled']

/**
 * Message used when a Run's terminal state exists only locally: persistence could not identify
 * any stored Run for the conditional write, so no state may be published and no cancellation
 * may be claimed. HTTP reports it as `SERVICE_UNAVAILABLE`.
 */
export const STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE = 'Studio Run state could not be persisted'

/**
 * Raised when a terminal transition produced no persisted Run. The caller must not invent a
 * terminal state, publish a `run_updated` event, or report success.
 */
export class StudioRunFinalizationError extends Error {
  constructor(options: { cause?: unknown } = {}) {
    super(STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE, options)
    this.name = 'StudioRunFinalizationError'
  }
}

export function isStudioRunTerminalStatus(status: StudioRunStatus): boolean {
  return STUDIO_RUN_TERMINAL_STATUSES.includes(status)
}

export function isStudioRunActiveStatus(status: StudioRunStatus): boolean {
  return STUDIO_RUN_ACTIVE_STATUSES.includes(status)
}

/**
 * Single source of truth for the conditional transition rules used by Run finalization and
 * stale-Run reconciliation.
 *
 * The invariant is that a terminal state is only ever reachable *from* an active state:
 *
 * - `from` must be non-empty, and every allowed source status must be active
 *   (`pending`/`running`) — a terminal Run is never rewritten, so a cancellation can never be
 *   overwritten by a late completion and vice versa;
 * - the target must be terminal (`completed`/`failed`/`cancelled`) — a transition may never
 *   move a Run back into an active state.
 *
 * Centralized here so success, failure, cancellation and reconciliation cannot drift apart.
 */
export function canTransitionStudioRunStatus(from: readonly StudioRunStatus[], to: StudioRunStatus): boolean {
  if (from.length === 0 || !isStudioRunTerminalStatus(to)) {
    return false
  }
  return from.every((status) => isStudioRunActiveStatus(status))
}
