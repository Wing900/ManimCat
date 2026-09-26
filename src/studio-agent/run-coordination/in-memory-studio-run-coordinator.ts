import {
  STUDIO_RUN_DEFAULT_CANCEL_TTL_MS,
  STUDIO_RUN_DEFAULT_LEASE_TTL_MS,
  createStudioRunOwnerInstanceId,
  type StudioRunCancellationCommand,
  type StudioRunCancellationListener,
  type StudioRunCoordinationLogger,
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

const NOOP_LOGGER: StudioRunCoordinationLogger = {
  info() {},
  warn() {},
  error() {}
}

/**
 * Single-instance coordinator with the same semantics as the Redis adapter: exclusive
 * session leases, token-checked renew/release, expiry, and durable cancellation markers
 * retained for their TTL. This is a real implementation, not a test stub — memory mode and
 * the specs both run against it.
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

  const leases = new Map<string, StudioRunLease>()
  const cancellations = new Map<string, StoredCancellation>()
  // Several services can share one in-process coordinator (a single process modelling more
  // than one replica, as the specs do); a Redis channel notifies every subscriber too.
  const listeners = new Set<StudioRunCancellationListener>()
  let started = false
  let closed = false

  function isExpired(lease: StudioRunLease): boolean {
    return lease.expiresAt <= now()
  }

  function readLiveLease(sessionId: string): StudioRunLease | null {
    const lease = leases.get(sessionId)
    if (!lease) {
      return null
    }
    if (isExpired(lease)) {
      leases.delete(sessionId)
      return null
    }
    return lease
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

    async tryAcquireSession(sessionId: string): Promise<StudioRunLease | null> {
      if (closed || !started) {
        throw new Error('Studio Run coordinator is not started')
      }
      if (readLiveLease(sessionId)) {
        // A live holder exists: this is a conflict, not an error.
        return null
      }
      const lease: StudioRunLease = {
        sessionId,
        leaseId: createId(),
        ownerInstanceId,
        expiresAt: now() + leaseTtlMs
      }
      leases.set(sessionId, lease)
      return lease
    },

    async renewSession(lease: StudioRunLease): Promise<StudioRunLease | null> {
      const current = readLiveLease(lease.sessionId)
      if (!current || current.leaseId !== lease.leaseId || current.ownerInstanceId !== lease.ownerInstanceId) {
        return null
      }
      const renewed: StudioRunLease = { ...current, expiresAt: now() + leaseTtlMs }
      leases.set(lease.sessionId, renewed)
      return renewed
    },

    async releaseSession(lease: StudioRunLease): Promise<boolean> {
      const current = readLiveLease(lease.sessionId)
      if (!current || current.leaseId !== lease.leaseId || current.ownerInstanceId !== lease.ownerInstanceId) {
        return false
      }
      leases.delete(lease.sessionId)
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
      leases.clear()
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
