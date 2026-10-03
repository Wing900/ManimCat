import {
  STUDIO_RUN_DEFAULT_CANCEL_TTL_MS,
  STUDIO_RUN_DEFAULT_LEASE_TTL_MS,
  canonicalStudioRunScopeKey,
  createStudioRunOwnerInstanceId,
  type StudioRunCancellationCommand,
  type StudioRunCancellationListener,
  type StudioRunCoordinationLogger,
  type StudioRunCoordinationScope,
  type StudioRunCoordinatorPort,
  type StudioRunLease
} from './studio-run-coordinator'
import { createStudioRunCancellationCommand } from './studio-run-cancellation-codec'

export interface CreateInMemoryStudioRunCoordinatorOptions {
  leaseTtlMs?: number
  cancellationTtlMs?: number
  /** Injectable for deterministic specs; defaults to a unique per-process id. */
  ownerInstanceId?: string
  now?: () => number
  createId?: () => string
  logger?: StudioRunCoordinationLogger
}

interface StoredCancellation {
  command: StudioRunCancellationCommand
  expiresAt: number
}

/**
 * Admission state of one Session: at most one Session-exclusive Legacy holder and at most one
 * holder per Scene. Both live in one object so the conflict matrix is decided in one place.
 */
interface SessionHolderState {
  legacy: StudioRunLease | null
  scenes: Map<string, StudioRunLease>
}

const NOOP_LOGGER: StudioRunCoordinationLogger = {
  info() {},
  warn() {},
  error() {}
}

/**
 * Single-instance coordinator with the same semantics as the Redis adapter: hierarchical
 * admission, token-checked renew/release, expiry pruning, and durable cancellation markers
 * retained for their TTL. This is a real implementation, not a test stub — memory mode and
 * the specs both run against it.
 *
 * Several service objects sharing one coordinator observe the same holder state (a single
 * process modelling more than one replica, as the specs do); two separate coordinators are
 * two separate processes and prove nothing about distribution.
 */
export function createInMemoryStudioRunCoordinator(
  options: CreateInMemoryStudioRunCoordinatorOptions = {}
): StudioRunCoordinatorPort {
  const leaseTtlMs = options.leaseTtlMs ?? STUDIO_RUN_DEFAULT_LEASE_TTL_MS
  const cancellationTtlMs = options.cancellationTtlMs ?? STUDIO_RUN_DEFAULT_CANCEL_TTL_MS
  const ownerInstanceId = options.ownerInstanceId ?? createStudioRunOwnerInstanceId()
  const now = options.now ?? (() => Date.now())
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID())
  const logger = options.logger ?? NOOP_LOGGER

  const holders = new Map<string, SessionHolderState>()
  const cancellations = new Map<string, StoredCancellation>()
  // Several services can share one in-process coordinator (a single process modelling more
  // than one replica, as the specs do); a Redis channel notifies every subscriber too.
  const listeners = new Set<StudioRunCancellationListener>()
  let started = false
  let closed = false

  function isExpired(lease: StudioRunLease): boolean {
    return lease.expiresAt <= now()
  }

  /** Drops every expired holder first, so an expired lease can never be observed as live. */
  function pruneExpiredHolders(): void {
    for (const [sessionId, state] of holders) {
      if (state.legacy && isExpired(state.legacy)) {
        state.legacy = null
      }
      for (const [sceneKey, lease] of state.scenes) {
        if (isExpired(lease)) {
          state.scenes.delete(sceneKey)
        }
      }
      if (!state.legacy && state.scenes.size === 0) {
        holders.delete(sessionId)
      }
    }
  }

  function readHolder(state: SessionHolderState | undefined, scope: StudioRunCoordinationScope): StudioRunLease | null {
    if (!state) {
      return null
    }
    return scope.kind === 'legacy-session' ? state.legacy : state.scenes.get(canonicalStudioRunScopeKey(scope)) ?? null
  }

  function writeHolder(state: SessionHolderState, lease: StudioRunLease): void {
    if (lease.scope.kind === 'legacy-session') {
      state.legacy = lease
      return
    }
    state.scenes.set(canonicalStudioRunScopeKey(lease.scope), lease)
  }

  function removeHolder(state: SessionHolderState, scope: StudioRunCoordinationScope): void {
    if (scope.kind === 'legacy-session') {
      state.legacy = null
    } else {
      state.scenes.delete(canonicalStudioRunScopeKey(scope))
    }
    if (!state.legacy && state.scenes.size === 0) {
      holders.delete(scope.sessionId)
    }
  }

  /** The conflict matrix, in one place: a Legacy holder excludes everything in its Session. */
  function conflicts(state: SessionHolderState | undefined, scope: StudioRunCoordinationScope): boolean {
    if (!state) {
      return false
    }
    if (scope.kind === 'legacy-session') {
      return state.legacy !== null || state.scenes.size > 0
    }
    return state.legacy !== null || state.scenes.has(canonicalStudioRunScopeKey(scope))
  }

  function readLiveCancellation(runId: string): StudioRunCancellationCommand | null {
    const stored = cancellations.get(runId)
    if (!stored) {
      return null
    }
    if (stored.expiresAt <= now()) {
      cancellations.delete(runId)
      return null
    }
    return stored.command
  }

  return {
    async start(onCancellation: StudioRunCancellationListener): Promise<void> {
      if (closed) {
        throw new Error('Studio Run coordinator is closed')
      }
      if (started) {
        return
      }
      listeners.add(onCancellation)
      started = true
    },

    async tryAcquire(scope: StudioRunCoordinationScope): Promise<StudioRunLease | null> {
      if (closed || !started) {
        throw new Error('Studio Run coordinator is not started')
      }
      pruneExpiredHolders()
      const state = holders.get(scope.sessionId)
      if (conflicts(state, scope)) {
        // A live holder in this scope (or a Legacy holder anywhere in the Session) is a
        // conflict, not an error.
        return null
      }
      const lease: StudioRunLease = {
        scope,
        leaseId: createId(),
        ownerInstanceId,
        expiresAt: now() + leaseTtlMs
      }
      const target = state ?? { legacy: null, scenes: new Map<string, StudioRunLease>() }
      writeHolder(target, lease)
      holders.set(scope.sessionId, target)
      return lease
    },

    async renew(lease: StudioRunLease): Promise<StudioRunLease | null> {
      pruneExpiredHolders()
      const state = holders.get(lease.scope.sessionId)
      const current = readHolder(state, lease.scope)
      if (!current || current.leaseId !== lease.leaseId || current.ownerInstanceId !== lease.ownerInstanceId) {
        return null
      }
      const renewed: StudioRunLease = { ...current, expiresAt: now() + leaseTtlMs }
      writeHolder(state as SessionHolderState, renewed)
      return renewed
    },

    async release(lease: StudioRunLease): Promise<boolean> {
      pruneExpiredHolders()
      const state = holders.get(lease.scope.sessionId)
      const current = readHolder(state, lease.scope)
      if (!state || !current || current.leaseId !== lease.leaseId || current.ownerInstanceId !== lease.ownerInstanceId) {
        return false
      }
      removeHolder(state, lease.scope)
      return true
    },

    async requestCancellation(runId: string, reason: string): Promise<StudioRunCancellationCommand> {
      if (closed) {
        throw new Error('Studio Run coordinator is closed')
      }
      const command = createStudioRunCancellationCommand({ runId, reason: reason ?? undefined, commandId: createId() })
      // Durable marker first, then the fast notification: a missed notification is
      // recovered on attachment or on the next renewal tick.
      cancellations.set(runId, { command, expiresAt: now() + cancellationTtlMs })
      notify(command)
      return command
    },

    async readCancellation(runId: string): Promise<StudioRunCancellationCommand | null> {
      return readLiveCancellation(runId)
    },

    async close(): Promise<void> {
      if (closed) {
        return
      }
      closed = true
      started = false
      listeners.clear()
      holders.clear()
      cancellations.clear()
    }
  }

  function notify(command: StudioRunCancellationCommand): void {
    for (const listener of listeners) {
      try {
        listener(command)
      } catch (error) {
        // A throwing listener must not break the cancellation request itself.
        logger.error('Studio Run cancellation listener failed', messageOf(error))
      }
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
