import { randomUUID } from 'node:crypto'

/**
 * Transport-neutral Run coordination contract.
 *
 * A Studio session is owned by at most one replica at a time through a session lease. The
 * lease is the admission primitive: acquiring it before persisting a Run closes the window
 * where two replicas create Runs for the same session. Cancellation travels as a durable
 * command so it survives a replica that missed the fast Pub/Sub notification.
 *
 * Nothing in this module knows about Redis, Pub/Sub or timers: adapters implement it.
 */

export interface StudioRunLease {
  sessionId: string
  leaseId: string
  ownerInstanceId: string
  /** Absolute epoch milliseconds at which the lease stops being valid. */
  expiresAt: number
}

export interface StudioRunCancellationCommand {
  version: 1
  commandId: string
  runId: string
  reason: string
  requestedAt: string
}

export type StudioRunCancellationListener = (command: StudioRunCancellationCommand) => void

export interface StudioRunCoordinatorPort {
  /**
   * Subscribes to cancellation commands (or wires the in-process callback). Idempotent.
   * A rejection means coordination is unavailable and startup must fail instead of
   * silently degrading to a replica that can neither be cancelled nor safely admitted.
   */
  start(onCancellation: StudioRunCancellationListener): Promise<void>
  /** `null` is a genuine conflict; a thrown error means coordination is unavailable. */
  tryAcquireSession(sessionId: string): Promise<StudioRunLease | null>
  /** Returns a fresh expiration while ownership still matches, `null` once it is lost. */
  renewSession(lease: StudioRunLease): Promise<StudioRunLease | null>
  /** Deletes only the matching lease token; `false` means ownership already moved on. */
  releaseSession(lease: StudioRunLease): Promise<boolean>
  /** Durably records the cancellation and signals it quickly. Throws when unavailable. */
  requestCancellation(runId: string, reason: string): Promise<StudioRunCancellationCommand>
  /** Reads the durable marker; `null` when absent or malformed. Throws on transport failure. */
  readCancellation(runId: string): Promise<StudioRunCancellationCommand | null>
  close(): Promise<void>
}

export interface StudioRunCoordinationLogger {
  info: (message: string, meta?: unknown) => void
  warn: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

export const STUDIO_RUN_COORDINATION_ENV = 'STUDIO_RUN_COORDINATION'
export const STUDIO_RUN_REDIS_PREFIX_ENV = 'STUDIO_RUN_REDIS_PREFIX'
export const STUDIO_RUN_CONTROL_CHANNEL_ENV = 'STUDIO_RUN_CONTROL_CHANNEL'
export const STUDIO_RUN_LEASE_TTL_ENV = 'STUDIO_RUN_LEASE_TTL_MS'
export const STUDIO_RUN_LEASE_RENEW_ENV = 'STUDIO_RUN_LEASE_RENEW_MS'
export const STUDIO_RUN_CANCEL_TTL_ENV = 'STUDIO_RUN_CANCEL_TTL_MS'

export const STUDIO_RUN_DEFAULT_LEASE_TTL_MS = 60_000
export const STUDIO_RUN_DEFAULT_LEASE_RENEW_MS = 15_000
export const STUDIO_RUN_DEFAULT_CANCEL_TTL_MS = 3_600_000
export const STUDIO_RUN_MIN_LEASE_TTL_MS = 1_000
export const STUDIO_RUN_MAX_LEASE_TTL_MS = 1_800_000
export const STUDIO_RUN_MIN_LEASE_RENEW_MS = 100
export const STUDIO_RUN_MIN_CANCEL_TTL_MS = 1_000
export const STUDIO_RUN_MAX_CANCEL_TTL_MS = 86_400_000
export const STUDIO_RUN_MAX_NAME_LENGTH = 200

/** Abort reason used when ownership can no longer be proven. */
export const STUDIO_RUN_LEASE_LOST_REASON = 'Studio Run lease lost'
/** Abort reason used while the process shuts down with Runs still owned. */
export const STUDIO_RUN_COORDINATION_SHUTDOWN_REASON = 'Studio Run coordination shut down'
export const STUDIO_RUN_CANCELLED_BY_USER_REASON = 'Run cancelled by user'
/** Operational message persisted on a Run whose owner lease expired. */
export const STUDIO_RUN_STALE_OWNER_MESSAGE = 'Run owner lease expired'

export type StudioRunCoordinationTransport = 'memory' | 'redis'

/**
 * `redis` is the production default; `memory` is the explicit single-instance fallback and
 * the default under `NODE_ENV=test`. Unknown values fail fast rather than guessing.
 */
export function resolveStudioRunCoordinationTransport(
  env: NodeJS.ProcessEnv = process.env
): StudioRunCoordinationTransport {
  const raw = env[STUDIO_RUN_COORDINATION_ENV]?.trim().toLowerCase()
  if (!raw) {
    return env.NODE_ENV?.trim() === 'test' ? 'memory' : 'redis'
  }
  if (raw === 'memory' || raw === 'redis') {
    return raw
  }
  throw new Error(`${STUDIO_RUN_COORDINATION_ENV} must be either "redis" or "memory"`)
}

export function resolveStudioRunLeaseTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInteger(env, STUDIO_RUN_LEASE_TTL_ENV, {
    fallback: STUDIO_RUN_DEFAULT_LEASE_TTL_MS,
    min: STUDIO_RUN_MIN_LEASE_TTL_MS,
    max: STUDIO_RUN_MAX_LEASE_TTL_MS
  })
}

/**
 * Renewal must happen well inside the TTL, otherwise a slow tick could let the lease lapse
 * while the Run is still producing. Half the TTL is the documented ceiling.
 */
export function resolveStudioRunLeaseRenewMs(
  env: NodeJS.ProcessEnv = process.env,
  leaseTtlMs: number = resolveStudioRunLeaseTtlMs(env)
): number {
  const renewMs = readBoundedInteger(env, STUDIO_RUN_LEASE_RENEW_ENV, {
    fallback: STUDIO_RUN_DEFAULT_LEASE_RENEW_MS,
    min: STUDIO_RUN_MIN_LEASE_RENEW_MS,
    max: Math.max(STUDIO_RUN_MIN_LEASE_RENEW_MS, Math.floor(leaseTtlMs / 2) - 1)
  })
  if (renewMs * 2 >= leaseTtlMs) {
    throw new Error(`${STUDIO_RUN_LEASE_RENEW_ENV} must be less than half ${STUDIO_RUN_LEASE_TTL_ENV}`)
  }
  return renewMs
}

export function resolveStudioRunCancellationTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInteger(env, STUDIO_RUN_CANCEL_TTL_ENV, {
    fallback: STUDIO_RUN_DEFAULT_CANCEL_TTL_MS,
    min: STUDIO_RUN_MIN_CANCEL_TTL_MS,
    max: STUDIO_RUN_MAX_CANCEL_TTL_MS
  })
}

export function resolveStudioRunRedisPrefix(env: NodeJS.ProcessEnv = process.env): string {
  return readScopedName(
    env,
    STUDIO_RUN_REDIS_PREFIX_ENV,
    `manimcat:${resolveEnvironmentScope(env)}:studio-run`
  )
}

export function resolveStudioRunControlChannel(env: NodeJS.ProcessEnv = process.env): string {
  return readScopedName(
    env,
    STUDIO_RUN_CONTROL_CHANNEL_ENV,
    `manimcat:${resolveEnvironmentScope(env)}:studio-run-control`
  )
}

/** Stable per-process identity; combined with an unguessable lease id it fences ownership. */
export function createStudioRunOwnerInstanceId(): string {
  return `${process.pid}-${randomUUID()}`
}

function resolveEnvironmentScope(env: NodeJS.ProcessEnv): string {
  const raw = env.NODE_ENV?.trim()
  return raw ? raw : 'production'
}

function readBoundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  bounds: { fallback: number; min: number; max: number }
): number {
  const raw = env[name]?.trim()
  if (!raw) {
    return bounds.fallback
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    throw new Error(`${name} must be an integer between ${bounds.min} and ${bounds.max}`)
  }
  return value
}

function readScopedName(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name]?.trim()
  if (!raw) {
    return fallback
  }
  if (/\s/.test(raw) || raw.length > STUDIO_RUN_MAX_NAME_LENGTH) {
    throw new Error(`${name} must be a non-empty name without whitespace, at most ${STUDIO_RUN_MAX_NAME_LENGTH} characters`)
  }
  return raw.replace(/:+$/, '') || fallback
}
