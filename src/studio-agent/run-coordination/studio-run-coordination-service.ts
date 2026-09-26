import type { StudioEventBus, StudioRun } from '../domain/types'
import type { StudioRunStore } from '../domain/store-types'
import { STUDIO_RUN_ACTIVE_STATUSES, isStudioRunTerminalStatus } from '../runs/run-status-transitions'
import {
  normalizeStudioRunCancellationReason
} from './studio-run-cancellation-codec'
import {
  STUDIO_RUN_COORDINATION_SHUTDOWN_REASON,
  STUDIO_RUN_LEASE_LOST_REASON,
  STUDIO_RUN_STALE_OWNER_MESSAGE,
  type StudioRunCancellationCommand,
  type StudioRunCoordinationLogger,
  type StudioRunCoordinatorPort,
  type StudioRunLease
} from './studio-run-coordinator'

/** Opaque to callers: everything about the lease stays inside this service. */
export interface StudioRunReservation {
  sessionId: string
  leaseId: string
}

export type StudioRunAdmission =
  | { status: 'reserved'; reservation: StudioRunReservation }
  | { status: 'conflict' }
  | { status: 'coordination_unavailable'; message: string }

export interface StudioRunAttachment {
  cancelled: boolean
  reason?: string
}

export type StudioRunCancellationOutcome =
  | { status: 'signalled'; command: StudioRunCancellationCommand }
  | { status: 'coordination_unavailable'; message: string }

/** What `StudioRunService` consumes. Locking, timers and transport stay behind this port. */
export interface StudioRunCoordinationServicePort {
  reserveSession: (input: { ownerId: string; sessionId: string }) => Promise<StudioRunAdmission>
  attachRun: (input: {
    reservation: StudioRunReservation
    runId: string
    abort: (reason?: string) => void
  }) => Promise<StudioRunAttachment>
  finishRun: (input: { reservation: StudioRunReservation; runId?: string }) => Promise<void>
  requestCancellation: (input: { runId: string; reason?: string }) => Promise<StudioRunCancellationOutcome>
}

/** One renewal loop for every local lease, instead of an unmanaged timer per Run. */
export interface StudioRunRenewalScheduler {
  schedule: (intervalMs: number, tick: () => void) => () => void
}

export function createIntervalStudioRunRenewalScheduler(): StudioRunRenewalScheduler {
  return {
    schedule(intervalMs, tick) {
      const timer = setInterval(tick, intervalMs)
      // Coordination bookkeeping must never hold the process open.
      timer.unref()
      return () => clearInterval(timer)
    }
  }
}

export interface StudioRunCoordinationServiceOptions {
  coordinator: StudioRunCoordinatorPort
  runStore?: StudioRunStore
  eventBus?: StudioEventBus
  logger?: StudioRunCoordinationLogger
  scheduler?: StudioRunRenewalScheduler
  leaseRenewMs?: number
  now?: () => number
}

export const STUDIO_RUN_COORDINATION_UNAVAILABLE_MESSAGE = 'Studio Run coordination is unavailable'

interface LocalRunEntry {
  lease: StudioRunLease
  runId: string | null
  abort: ((reason?: string) => void) | null
  aborted: boolean
  abortReason?: string
}

const NOOP_LOGGER: StudioRunCoordinationLogger = {
  info() {},
  warn() {},
  error() {}
}

const DEFAULT_LEASE_RENEW_MS = 15_000

/**
 * Application-level Run coordination: it owns the local handle registry, one lease renewal
 * scheduler, cancellation dispatch and stale Run reconciliation, and it is the only place
 * that decides what happens when ownership is lost.
 *
 * Behavior on ownership loss is deliberately fail-closed: a Lease Lost or an unprovable
 * renewal aborts the local Run once, because continuing to generate would let two replicas
 * write to one session.
 */
export class StudioRunCoordinationService implements StudioRunCoordinationServicePort {
  private readonly coordinator: StudioRunCoordinatorPort
  private readonly runStore?: StudioRunStore
  private readonly eventBus?: StudioEventBus
  private readonly logger: StudioRunCoordinationLogger
  private readonly scheduler: StudioRunRenewalScheduler
  private readonly renewMs: number
  private readonly now: () => number

  private readonly entries = new Map<string, LocalRunEntry>()
  private readonly sessionByRunId = new Map<string, string>()
  private stopScheduler: (() => void) | null = null
  private startPromise: Promise<void> | null = null
  private closePromise: Promise<void> | null = null
  private pendingRenewal: Promise<void> = Promise.resolve()
  private renewalInFlight = false
  private closed = false

  constructor(options: StudioRunCoordinationServiceOptions) {
    this.coordinator = options.coordinator
    this.runStore = options.runStore
    this.eventBus = options.eventBus
    this.logger = options.logger ?? NOOP_LOGGER
    this.scheduler = options.scheduler ?? createIntervalStudioRunRenewalScheduler()
    this.renewMs = options.leaseRenewMs ?? DEFAULT_LEASE_RENEW_MS
    this.now = options.now ?? (() => Date.now())
  }

  /** Idempotent; a rejection means the control subscription could not be established. */
  start(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Studio Run coordination service is closed'))
    }
    this.startPromise ??= this.coordinator.start((command) => {
      this.dispatchCancellation(command)
    })
    return this.startPromise
  }

  async reserveSession(input: { ownerId: string; sessionId: string }): Promise<StudioRunAdmission> {
    if (this.closed) {
      return unavailable()
    }
    try {
      await this.start()
    } catch (error) {
      this.log.error('Studio Run coordination start failed', messageOf(error))
      return unavailable()
    }

    let lease: StudioRunLease | null
    try {
      lease = await this.coordinator.tryAcquireSession(input.sessionId)
    } catch (error) {
      // A thrown acquisition is "coordination unavailable", never a silent conflict.
      this.log.error('Studio Run lease acquisition failed', messageOf(error))
      return unavailable()
    }
    if (!lease) {
      return { status: 'conflict' }
    }

    // Provisional local ownership, registered *before* reconciliation so the shared renewal
    // scheduler already protects the lease while (possibly slow) reconciliation runs. Without
    // this ordering a long query could outlive the TTL and let another replica take the session.
    const entry: LocalRunEntry = { lease, runId: null, abort: null, aborted: false }
    this.entries.set(input.sessionId, entry)

    // No renewal mechanism means no safe ownership: refuse before doing any work.
    if (!this.ensureScheduler()) {
      await this.rollbackProvisionalEntry(entry)
      return unavailable()
    }

    if (!(await this.reconcileStaleRuns(input))) {
      await this.rollbackProvisionalEntry(entry)
      return unavailable()
    }

    // Final ownership proof: reconciliation may have outlived the lease, in which case another
    // replica could already hold the session and this reservation must never be exposed.
    if (!(await this.confirmProvisionalOwnership(entry))) {
      await this.rollbackProvisionalEntry(entry)
      return unavailable()
    }

    // Last check before exposure: a newer local admission may have replaced this entry while the
    // proof was awaited. The rollback is identity-safe, so it cannot remove the newer entry.
    if (this.entries.get(input.sessionId) !== entry || entry.aborted) {
      this.log.warn('Studio Run admission was superseded before it was exposed')
      await this.rollbackProvisionalEntry(entry)
      return unavailable()
    }

    return { status: 'reserved', reservation: { sessionId: input.sessionId, leaseId: entry.lease.leaseId } }
  }

  async attachRun(input: {
    reservation: StudioRunReservation
    runId: string
    abort: (reason?: string) => void
  }): Promise<StudioRunAttachment> {
    const entry = this.entries.get(input.reservation.sessionId)
    if (!entry || entry.lease.leaseId !== input.reservation.leaseId) {
      // Ownership disappeared while the Run was being created: never keep producing.
      input.abort(STUDIO_RUN_LEASE_LOST_REASON)
      return { cancelled: true, reason: STUDIO_RUN_LEASE_LOST_REASON }
    }

    // Register before reading the marker so a concurrent command can abort this handle.
    entry.runId = input.runId
    entry.abort = input.abort
    this.sessionByRunId.set(input.runId, input.reservation.sessionId)

    // Recovery for a cancellation that arrived before attachment (missed or in-flight).
    const marker = await this.readCancellationMarker(input.runId)
    if (marker) {
      this.abortEntry(entry, marker.reason)
      return { cancelled: true, reason: marker.reason }
    }
    if (entry.aborted) {
      return { cancelled: true, reason: entry.abortReason ?? STUDIO_RUN_LEASE_LOST_REASON }
    }
    return { cancelled: false }
  }

  async finishRun(input: { reservation: StudioRunReservation; runId?: string }): Promise<void> {
    const entry = this.entries.get(input.reservation.sessionId)
    if (!entry || entry.lease.leaseId !== input.reservation.leaseId) {
      return
    }
    if (input.runId && entry.runId && entry.runId !== input.runId) {
      return
    }
    this.removeLocalEntry(entry)
    await this.releaseLease(entry.lease)
  }

  async requestCancellation(input: {
    runId: string
    reason?: string
  }): Promise<StudioRunCancellationOutcome> {
    if (this.closed) {
      return unavailable()
    }
    const reason = normalizeStudioRunCancellationReason(input.reason)
    let command: StudioRunCancellationCommand
    try {
      command = await this.coordinator.requestCancellation(input.runId, reason)
    } catch (error) {
      // The durable marker could not be written: never claim remote cancellation.
      this.log.error('Studio Run cancellation could not be signalled', messageOf(error))
      return unavailable()
    }
    this.dispatchCancellation(command)
    return { status: 'signalled', command }
  }

  /** Test hook: the local expiration this replica currently believes it holds. */
  getSessionLease(sessionId: string): StudioRunLease | null {
    return this.entries.get(sessionId)?.lease ?? null
  }

  /** Test hook: Runs this replica currently owns locally. */
  getActiveRunIds(): string[] {
    return [...this.sessionByRunId.keys()]
  }

  /** Deterministic drain hook for tests; production never awaits a renewal tick. */
  whenIdle(): Promise<void> {
    return this.pendingRenewal
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeInternal()
    return this.closePromise
  }

  private async closeInternal(): Promise<void> {
    this.closed = true
    if (this.stopScheduler) {
      this.stopScheduler()
      this.stopScheduler = null
    }

    const entries = [...this.entries.values()]
    this.entries.clear()
    this.sessionByRunId.clear()
    for (const entry of entries) {
      if (!entry.aborted) {
        this.abortEntry(entry, STUDIO_RUN_COORDINATION_SHUTDOWN_REASON)
      }
      await this.releaseLease(entry.lease)
    }

    try {
      await this.coordinator.close()
    } catch (error) {
      this.log.warn('Studio Run coordinator close failed', messageOf(error))
    }
  }

  /**
   * Runs only after the session lease is held, which proves no live owner is left behind.
   * A terminal Run is never touched again. Anything else that leaves an unresolved active Run
   * (a store that cannot identify the row, a store that ignores the conditional transition, a
   * thrown query) refuses admission rather than creating a new Run beside a stale one.
   */
  private async reconcileStaleRuns(input: { ownerId: string; sessionId: string }): Promise<boolean> {
    const store = this.runStore
    if (!store) {
      return true
    }

    let runs: StudioRun[]
    try {
      runs = await store.listBySessionId(input.ownerId, input.sessionId)
    } catch (error) {
      this.log.error('Studio Run reconciliation could not list session runs', messageOf(error))
      return false
    }

    for (const run of runs) {
      if (!STUDIO_RUN_ACTIVE_STATUSES.includes(run.status)) {
        continue
      }
      try {
        const result = await store.transitionStatus({
          ownerId: input.ownerId,
          runId: run.id,
          from: STUDIO_RUN_ACTIVE_STATUSES,
          patch: {
            status: 'failed',
            completedAt: new Date(this.now()).toISOString(),
            error: STUDIO_RUN_STALE_OWNER_MESSAGE
          }
        })
        if (!result.run) {
          // The Run was listed but the conditional write could not identify it: the stale Run
          // is still unresolved, so no new Run may be admitted.
          this.log.error('Studio Run reconciliation could not identify a listed Run')
          return false
        }
        const persisted = result.run
        if (result.applied) {
          this.publishRunUpdated(persisted)
          continue
        }
        if (isStudioRunTerminalStatus(persisted.status)) {
          // Another writer already finished it; nothing to publish from here.
          continue
        }
        // Not applied yet still active: the store does not honour the transition contract.
        this.log.error('Studio Run reconciliation did not clear a stale Run')
        return false
      } catch (error) {
        this.log.error('Studio Run reconciliation failed', messageOf(error))
        return false
      }
    }
    return true
  }

  /**
   * Conditional renew used as the ownership proof after reconciliation: a lost token or an
   * unprovable renewal both mean this replica may no longer admit a Run for the session.
   *
   * The renewal is queued in the same lane as the scheduled renewal, so a failed scheduler tick
   * cannot be overtaken by this proof; that is why the abort state is re-read *after* the await,
   * together with the entry identity and the renewed lease identity.
   */
  private async confirmProvisionalOwnership(entry: LocalRunEntry): Promise<StudioRunLease | null> {
    if (entry.aborted) {
      return null
    }
    const sessionId = entry.lease.sessionId
    let renewed: StudioRunLease | null
    try {
      renewed = await this.serializeRenewal(() => this.coordinator.renewSession(entry.lease))
    } catch (error) {
      this.log.error('Studio Run lease renewal failed', messageOf(error))
      return null
    }
    if (!renewed) {
      return null
    }
    if (this.entries.get(sessionId) !== entry || entry.aborted) {
      // The entry was replaced by a newer local admission, or declared unsafe, while we awaited.
      this.log.warn('Studio Run admission lost its provisional ownership while proving it')
      return null
    }
    if (renewed.leaseId !== entry.lease.leaseId || renewed.ownerInstanceId !== entry.lease.ownerInstanceId) {
      this.log.error('Studio Run lease renewal returned a different lease identity')
      return null
    }
    entry.lease = renewed
    return renewed
  }

  /**
   * Identity-safe local removal: only the exact entry may be removed, and only its own Run mapping
   * may be dropped. A stale rollback must never remove or orphan state that belongs to a newer
   * entry for the same session; the lease release itself stays token-checked at the coordinator.
   */
  private removeLocalEntry(entry: LocalRunEntry): boolean {
    const sessionId = entry.lease.sessionId
    if (this.entries.get(sessionId) !== entry) {
      return false
    }
    this.entries.delete(sessionId)
    if (entry.runId && this.sessionByRunId.get(entry.runId) === sessionId) {
      this.sessionByRunId.delete(entry.runId)
    }
    return true
  }

  /**
   * Drops provisional local state (identity-safe) and hands the matching lease back; a lease that
   * is no longer ours is left alone by the coordinator's token check, and TTL is the fallback.
   */
  private async rollbackProvisionalEntry(entry: LocalRunEntry): Promise<void> {
    this.removeLocalEntry(entry)
    await this.releaseLease(entry.lease)
  }

  /**
   * One per-service serialized renewal lane shared by scheduled ticks and the admission-time
   * ownership proof. Serializing them is what makes "a failed scheduler renewal cannot be
   * overtaken by the proof" true, and it keeps `whenIdle()` a single deterministic drain hook.
   */
  private serializeRenewal<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingRenewal.then(operation, operation)
    this.pendingRenewal = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /** `true` means one shared renewal loop is active for every local lease. */
  private ensureScheduler(): boolean {
    if (this.closed) {
      return false
    }
    if (this.stopScheduler) {
      return true
    }
    try {
      this.stopScheduler = this.scheduler.schedule(this.renewMs, () => {
        // Queued in the same lane as the ownership proof, so a tick cannot overlap it.
        void this.serializeRenewal(() => this.renewLocalLeases()).catch((error) => {
          this.log.error('Studio Run lease renewal tick failed', messageOf(error))
        })
      })
      return true
    } catch (error) {
      // Admission must fail: a reservation without renewal cannot be safely owned.
      this.log.error('Studio Run lease renewal could not be scheduled', messageOf(error))
      return false
    }
  }

  private async renewLocalLeases(): Promise<void> {
    if (this.renewalInFlight || this.closed) {
      return
    }
    this.renewalInFlight = true
    try {
      for (const entry of [...this.entries.values()]) {
        if (entry.aborted) {
          continue
        }
        if (entry.runId) {
          // Recovery for a missed Pub/Sub notification, before extending ownership.
          const marker = await this.readCancellationMarker(entry.runId)
          if (marker) {
            this.abortEntry(entry, marker.reason)
            continue
          }
        }

        let renewed: StudioRunLease | null
        try {
          renewed = await this.coordinator.renewSession(entry.lease)
        } catch (error) {
          // Ownership can no longer be proven: fail closed rather than keep running.
          this.log.error('Studio Run lease renewal failed', messageOf(error))
          this.abortEntry(entry, STUDIO_RUN_LEASE_LOST_REASON)
          continue
        }
        if (!renewed) {
          this.abortEntry(entry, STUDIO_RUN_LEASE_LOST_REASON)
          continue
        }
        entry.lease = renewed
      }
    } finally {
      this.renewalInFlight = false
    }
  }

  private dispatchCancellation(command: StudioRunCancellationCommand): void {
    const sessionId = this.sessionByRunId.get(command.runId)
    if (!sessionId) {
      // Another replica owns this Run: the durable marker is its recovery path.
      return
    }
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    this.abortEntry(entry, command.reason)
  }

  private abortEntry(entry: LocalRunEntry, reason: string): void {
    if (entry.aborted) {
      return
    }
    entry.aborted = true
    entry.abortReason = reason
    try {
      entry.abort?.(reason)
    } catch (error) {
      this.log.error('Studio Run local abort failed', messageOf(error))
    }
  }

  private async readCancellationMarker(runId: string): Promise<StudioRunCancellationCommand | null> {
    let marker: StudioRunCancellationCommand | null
    try {
      marker = await this.coordinator.readCancellation(runId)
    } catch (error) {
      // A marker read failure is not ownership loss; the next renewal tick retries it.
      this.log.warn('Studio Run cancellation marker could not be read', messageOf(error))
      return null
    }
    if (marker && marker.runId !== runId) {
      // Defence in depth on top of the adapter check: a marker whose payload names another Run
      // must never abort this one. Only a fixed reason is logged, never payload content.
      this.log.warn('Ignoring Studio Run cancellation marker that does not match the requested Run')
      return null
    }
    return marker
  }

  private async releaseLease(lease: StudioRunLease): Promise<void> {
    try {
      await this.coordinator.releaseSession(lease)
    } catch (error) {
      // Local state is already gone; lease TTL is the recovery mechanism.
      this.log.warn('Studio Run lease release failed', messageOf(error))
    }
  }

  private publishRunUpdated(run: StudioRun): void {
    try {
      this.eventBus?.publish({ type: 'run_updated', sessionId: run.sessionId, run })
    } catch (error) {
      this.log.error('Studio Run reconciliation publish failed', messageOf(error))
    }
  }

  private get log(): StudioRunCoordinationLogger {
    return this.logger
  }
}

function unavailable(): { status: 'coordination_unavailable'; message: string } {
  return { status: 'coordination_unavailable', message: STUDIO_RUN_COORDINATION_UNAVAILABLE_MESSAGE }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
