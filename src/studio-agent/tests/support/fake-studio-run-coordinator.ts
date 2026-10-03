import {
  type StudioRunCancellationCommand,
  type StudioRunCancellationListener,
  type StudioRunCoordinationLogger,
  type StudioRunCoordinationScope,
  type StudioRunCoordinatorPort,
  type StudioRunLease
} from '../../run-coordination/studio-run-coordinator'
import { createStudioRunCancellationCommand } from '../../run-coordination/studio-run-cancellation-codec'

export interface RecordedCoordinationLogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  meta?: unknown
}

/** Recording logger double: specs assert on messages, never on live logging. */
export class RecordingStudioRunCoordinationLogger implements StudioRunCoordinationLogger {
  readonly entries: RecordedCoordinationLogEntry[] = []

  info(message: string, meta?: unknown): void {
    this.entries.push({ level: 'info', message, meta })
  }

  warn(message: string, meta?: unknown): void {
    this.entries.push({ level: 'warn', message, meta })
  }

  error(message: string, meta?: unknown): void {
    this.entries.push({ level: 'error', message, meta })
  }

  messages(level?: RecordedCoordinationLogEntry['level']): string[] {
    return this.entries.filter((entry) => !level || entry.level === level).map((entry) => entry.message)
  }
}

/**
 * Scripted `StudioRunCoordinatorPort` double for the specs: no Redis, no timers, and every
 * transport failure mode is injectable so the fail-closed paths can be exercised directly.
 */
export class FakeStudioRunCoordinator implements StudioRunCoordinatorPort {
  readonly acquiredScopes: StudioRunCoordinationScope[] = []
  readonly renewedLeases: StudioRunLease[] = []
  readonly releasedLeases: StudioRunLease[] = []
  readonly requestedRunIds: string[] = []
  readonly markers = new Map<string, StudioRunCancellationCommand>()

  startCount = 0
  closeCount = 0
  startError: Error | null = null
  acquireError: Error | null = null
  renewError: Error | null = null
  releaseError: Error | null = null
  requestCancellationError: Error | null = null
  readCancellationError: Error | null = null
  /** `true` forces a conflict; `false`/unset lets acquisition succeed. */
  acquireConflict = false
  /** When set, acquisition reports this error instead of returning a lease. */
  acquireReply: unknown = undefined
  /** When set, renewal reports lost ownership. */
  renewResult: StudioRunLease | null | undefined = undefined
  releaseResult = true

  private readonly listeners = new Set<StudioRunCancellationListener>()
  private leaseCounter = 0
  private commandCounter = 0
  private readonly ownerInstanceId: string

  constructor(options: { ownerInstanceId?: string } = {}) {
    this.ownerInstanceId = options.ownerInstanceId ?? 'owner-local'
  }

  async start(onCancellation: StudioRunCancellationListener): Promise<void> {
    this.startCount += 1
    if (this.startError) {
      throw this.startError
    }
    this.listeners.add(onCancellation)
  }

  async tryAcquire(scope: StudioRunCoordinationScope): Promise<StudioRunLease | null> {
    this.acquiredScopes.push(scope)
    if (this.acquireError) {
      throw this.acquireError
    }
    // Models an unexpected transport reply: the caller must fail closed, never admit.
    if (this.acquireReply !== undefined) {
      throw new Error('unexpected acquisition reply')
    }
    if (this.acquireConflict) {
      return null
    }
    this.leaseCounter += 1
    return {
      scope,
      leaseId: `lease-${this.leaseCounter}`,
      ownerInstanceId: this.ownerInstanceId,
      expiresAt: 1_000_000 + this.leaseCounter * 1_000
    }
  }

  async renew(lease: StudioRunLease): Promise<StudioRunLease | null> {
    this.renewedLeases.push(lease)
    if (this.renewError) {
      throw this.renewError
    }
    if (this.renewResult !== undefined) {
      return this.renewResult
    }
    return { ...lease, expiresAt: lease.expiresAt + 60_000 }
  }

  async release(lease: StudioRunLease): Promise<boolean> {
    this.releasedLeases.push(lease)
    if (this.releaseError) {
      throw this.releaseError
    }
    return this.releaseResult
  }

  async requestCancellation(runId: string, reason: string): Promise<StudioRunCancellationCommand> {
    this.requestedRunIds.push(runId)
    if (this.requestCancellationError) {
      throw this.requestCancellationError
    }
    this.commandCounter += 1
    const command = createStudioRunCancellationCommand({
      runId,
      reason,
      commandId: `command-${this.commandCounter}`,
      requestedAt: '2026-01-01T00:00:00.000Z'
    })
    this.markers.set(runId, command)
    this.deliver(command)
    return command
  }

  async readCancellation(runId: string): Promise<StudioRunCancellationCommand | null> {
    if (this.readCancellationError) {
      throw this.readCancellationError
    }
    return this.markers.get(runId) ?? null
  }

  async close(): Promise<void> {
    this.closeCount += 1
    this.listeners.clear()
  }

  /** Models the durable marker existing without the fast notification ever arriving. */
  setMarkerWithoutDelivery(command: StudioRunCancellationCommand): void {
    this.markers.set(command.runId, command)
  }

  /** Models the control Pub/Sub notification arriving at this replica. */
  deliver(command: StudioRunCancellationCommand): void {
    for (const listener of this.listeners) {
      listener(command)
    }
  }
}

/** Manual renewal scheduler: one recorded interval and an explicit, awaitable tick. */
export class ManualStudioRunRenewalScheduler {
  intervalMs: number | null = null
  scheduleCount = 0
  stopCount = 0
  private ticks: Array<() => void> = []
  private stopped = false

  schedule(intervalMs: number, tick: () => void): () => void {
    this.scheduleCount += 1
    this.intervalMs = intervalMs
    this.ticks.push(tick)
    return () => {
      this.stopCount += 1
      this.stopped = true
    }
  }

  /** Runs the most recently scheduled tick once. */
  runTick(): void {
    const tick = this.ticks[this.ticks.length - 1]
    if (!tick) {
      throw new Error('no renewal tick has been scheduled')
    }
    tick()
  }

  isStopped(): boolean {
    return this.stopped
  }
}

/** Bounded microtask drain: no sleeps, and it fails loudly instead of hanging forever. */
export async function waitFor(predicate: () => boolean, turns = 60): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    if (predicate()) {
      return
    }
    await Promise.resolve()
  }
  if (!predicate()) {
    throw new Error('condition was not met within the bounded microtask drain')
  }
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // The stub handle's completion is observed through `.finally`, so a rejection without a
  // consumer would otherwise surface as an unhandled rejection in the specs.
  promise.catch(() => {})
  return { promise, resolve, reject }
}
