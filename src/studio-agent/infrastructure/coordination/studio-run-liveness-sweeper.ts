import type { StudioRun } from '../../domain/types'
import { STUDIO_RUN_ACTIVE_STATUSES } from '../../runs/run-status-transitions'
import type { StudioRunCoordinationScope } from './studio-run-scope'
import { canonicalStudioRunScopeKey } from './studio-run-scope'
import type { StudioRunScopeLiveness } from './studio-run-coordination-service'

/**
 * How often the sweep runs. It does not decide safety — the lease does (60s TTL, renewed every 15s
 * by its owner) — it only bounds how long a Run abandoned by a dead replica keeps claiming to be
 * running before someone notices.
 */
export const STUDIO_RUN_LIVENESS_SWEEP_INTERVAL_MS = 30_000

/**
 * How long a Run must show no sign of life before a free scope may make it dead.
 *
 * A Run's lease is released just before its terminal state is written, so without a grace period a
 * sweep landing in that gap would declare a finished Run failed — and the conditional transition
 * would then refuse the truth that arrives a moment later. The sign of life is the last autonomy
 * checkpoint, which is what a working Run keeps refreshing.
 */
export const STUDIO_RUN_LIVENESS_GRACE_MS = 90_000

/** One sweep reads at most this many active Runs, so a growing table can never become a full scan. */
export const STUDIO_RUN_LIVENESS_SWEEP_LIMIT = 500

export interface StudioRunLivenessLogger {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

export interface StudioRunLivenessSweeperPort {
  listActiveRuns: (limit: number) => Promise<StudioRun[]>
  readScopeLiveness: (scope: StudioRunCoordinationScope) => Promise<StudioRunScopeLiveness>
  reconcileScopeRuns: (input: { ownerId: string; scope: StudioRunCoordinationScope }) => Promise<boolean>
}

export interface StudioRunLivenessSweeper {
  start: () => void
  stop: () => void
  /** One sweep, awaited. The interval tick and the specifications drive exactly this. */
  sweepOnce: () => Promise<void>
}

const NOOP_LOGGER: StudioRunLivenessLogger = {
  info() {},
  warn() {},
  error() {}
}

/**
 * Finalizes Runs whose owner process died without writing a terminal state.
 *
 * A Run's status is a database row; the worker that would move it to `failed` or `completed` is a
 * loop inside a process. When that process dies — crash, Ctrl-C, a deploy, a file save under
 * `tsx watch` — the row keeps saying `running` and nothing in it can tell "alive" from "abandoned".
 * The lease can, and asking the transport is what this sweep does.
 *
 * Three rules keep it safe to run on every replica at once:
 *
 * 1. the list is taken before any liveness question, so a Run created after this read is not in it
 *    and cannot be declared dead by a replica that acquired the scope in between;
 * 2. `unknown` is never read as `free` — an unreachable registry must not turn into a mass execution;
 * 3. a whole scope waits for its newest Run, because reconciliation finalizes every active Run in
 *    the scope rather than only the ones this sweep selected.
 */
export function createStudioRunLivenessSweeper(options: {
  port: StudioRunLivenessSweeperPort
  logger?: StudioRunLivenessLogger
  intervalMs?: number
  graceMs?: number
  limit?: number
  now?: () => number
}): StudioRunLivenessSweeper {
  const logger = options.logger ?? NOOP_LOGGER
  const intervalMs = options.intervalMs ?? STUDIO_RUN_LIVENESS_SWEEP_INTERVAL_MS
  const graceMs = options.graceMs ?? STUDIO_RUN_LIVENESS_GRACE_MS
  const limit = options.limit ?? STUDIO_RUN_LIVENESS_SWEEP_LIMIT
  const now = options.now ?? (() => Date.now())
  let timer: ReturnType<typeof setInterval> | null = null
  let sweeping = false

  return {
    start() {
      if (timer) {
        return
      }
      // One sweep immediately: after a restart the Runs abandoned by that very restart are the ones
      // worth finding, and waiting a whole interval for them would be pure latency.
      void sweepOnce()
      timer = setInterval(() => {
        void sweepOnce()
      }, intervalMs)
      timer.unref?.()
    },
    stop() {
      if (!timer) {
        return
      }
      clearInterval(timer)
      timer = null
    },
    sweepOnce
  }

  async function sweepOnce(): Promise<void> {
    // A slow sweep is skipped, never queued: two sweeps in flight would double every query and
    // could both act on the same stale list.
    if (sweeping) {
      return
    }
    sweeping = true
    try {
      await sweep()
    } catch (error) {
      logger.error('Studio Run liveness sweep failed', { message: messageOf(error) })
    } finally {
      sweeping = false
    }
  }

  async function sweep(): Promise<void> {
    const listed = await options.port.listActiveRuns(limit)
    const active = listed.filter((run) => STUDIO_RUN_ACTIVE_STATUSES.includes(run.status))
    if (active.length === 0) {
      return
    }

    const idleBefore = now() - graceMs
    for (const group of groupByScope(active).values()) {
      // One freshly touched Run protects its whole scope.
      if (!group.runs.every((run) => hasBeenIdleSince(run, idleBefore))) {
        continue
      }

      const liveness = await options.port.readScopeLiveness(group.scope)
      if (liveness === 'held') {
        continue
      }
      if (liveness === 'unknown') {
        logger.warn('Studio Run liveness is unknown, leaving its Runs untouched', { scope: group.scope })
        continue
      }

      const reconciled = await options.port.reconcileScopeRuns({ ownerId: group.ownerId, scope: group.scope })
      if (!reconciled) {
        logger.warn('Studio Run scope has no live owner but reconciliation was refused', { scope: group.scope })
        continue
      }
      logger.info('Studio Run liveness finalized Runs left behind by a dead owner', {
        scope: group.scope,
        runs: group.runs.length
      })
    }
  }

  function hasBeenIdleSince(run: StudioRun, idleBefore: number): boolean {
    const lastSignOfLife = Date.parse(readLastCheckpoint(run) ?? run.createdAt)
    // An unreadable timestamp is not evidence of death, so it fails towards leaving the Run alone.
    if (Number.isNaN(lastSignOfLife)) {
      return false
    }
    return lastSignOfLife <= idleBefore
  }
}

/**
 * The raw autonomy checkpoint, read straight off the Run.
 *
 * The policy reader is deliberately not used here: it fills a missing checkpoint with "right now",
 * which is the right default when starting a Run and exactly the wrong answer to "has this Run shown
 * any sign of life since?" — it would make a Run with no checkpoint look permanently fresh.
 */
function readLastCheckpoint(run: StudioRun): string | undefined {
  const autonomy = run.metadata?.autonomy
  if (!autonomy || typeof autonomy !== 'object' || Array.isArray(autonomy)) {
    return undefined
  }
  const value = (autonomy as Record<string, unknown>).lastCheckpointAt
  return typeof value === 'string' && value ? value : undefined
}

function groupByScope(
  runs: readonly StudioRun[]
): Map<string, { ownerId: string; scope: StudioRunCoordinationScope; runs: StudioRun[] }> {
  const groups = new Map<string, { ownerId: string; scope: StudioRunCoordinationScope; runs: StudioRun[] }>()
  for (const run of runs) {
    // One Session has one owner, and reconciliation is per owner and scope, so both belong in the key.
    const scope = scopeOf(run)
    const key = `${run.ownerId}|${canonicalStudioRunScopeKey(scope)}`
    const group = groups.get(key)
    if (group) {
      group.runs.push(run)
      continue
    }
    groups.set(key, { ownerId: run.ownerId, scope, runs: [run] })
  }
  return groups
}

/** The scope that gates admission for this Run, exactly as Run admission derives it. */
function scopeOf(run: StudioRun): StudioRunCoordinationScope {
  return run.sceneId
    ? { kind: 'scene', sessionId: run.sessionId, sceneId: run.sceneId }
    : { kind: 'legacy-session', sessionId: run.sessionId }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
