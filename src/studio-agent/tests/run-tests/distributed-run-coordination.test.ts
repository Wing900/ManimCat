import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  InMemoryStudioMessageStore,
  InMemoryStudioPartStore,
  InMemoryStudioEventBus,
  InMemoryStudioRunStore,
  STUDIO_RUN_ACTIVE_STATUSES,
  STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH,
  STUDIO_RUN_COORDINATION_UNAVAILABLE_MESSAGE,
  STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE,
  STUDIO_RUN_LEASE_LOST_REASON,
  STUDIO_RUN_STALE_OWNER_MESSAGE,
  StudioRunCoordinationService,
  assertStudioRunCancellationMarkerWritten,
  canTransitionStudioRunStatus,
  createDefaultStudioRunCoordination,
  createInMemoryStudioPersistence,
  createInMemoryStudioRunCoordinator,
  createStudioAssistantMessage,
  createStudioRun,
  createStudioRunCancellationCommand,
  createStudioRunService,
  createStudioSession,
  createSupabaseStudioPersistence,
  createStudioInfrastructureRuntime,
  decodeStudioRunCancellationCommand,
  encodeStudioRunKeySegment,
  normalizeStudioRunCancellationReason,
  resolveStudioEventChannel,
  resolveStudioRunCancellationTtlMs,
  resolveStudioRunControlChannel,
  resolveStudioRunCoordinationTransport,
  resolveStudioRunLeaseRenewMs,
  resolveStudioRunLeaseTtlMs,
  resolveStudioRunRedisPrefix,
  type StudioAgentEvent,
  type StudioEventBus,
  type StudioRun,
  type StudioRunCancellationCommand,
  type StudioRunCancellationListener,
  type StudioRunCoordinatorPort,
  type StudioRunCoordinationLogger,
  type StudioRunLease,
  type StudioRunStore,
  type StudioSession,
  type StudioEventBusRuntime,
  type StudioRunCoordinationRuntime
} from '../../index'
import type { StudioPersistence } from '../../persistence/studio-persistence'
import { handleFailedRun, finalizeSuccessfulRun } from '../../runtime/execution/session-runner/result-handler'
import type { StudioSessionRunnerDependencies } from '../../runtime/execution/session-runner/dependency-center'
import type { StudioBuilderRuntime } from '../../runtime/builder-runtime'
import {
  FakeStudioRunCoordinator,
  ManualStudioRunRenewalScheduler,
  RecordingStudioRunCoordinationLogger,
  createDeferred,
  waitFor,
  type Deferred
} from '../support/fake-studio-run-coordinator'
import { RecordingEventBus } from '../support/recording-event-bus'
import { run } from './factories'

const OWNER_ID = 'owner-1'
const RUN_START_REASON = 'user pressed stop'

type RunServiceRuntime = Pick<StudioBuilderRuntime, 'startBackgroundRun'>

function createSession(overrides: { title?: string } = {}): StudioSession {
  return createStudioSession({
    projectId: 'project-1',
    ownerId: OWNER_ID,
    agentType: 'builder',
    title: overrides.title ?? 'Scene',
    directory: 'C:/tmp/studio-workspace'
  })
}

/**
 * Run-runtime double: records that a lease was held while the Run was being started, records
 * aborts, and keeps each completion pending until the spec resolves or aborts it.
 */
function createStubRunRuntime(options: {
  leaseProbe?: () => boolean
  failWith?: Error
} = {}) {
  const startCalls: string[] = []
  const leaseHeld: boolean[] = []
  const abortReasons: string[] = []
  const pending: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []

  const runtime = {
    async startBackgroundRun(input: { session: StudioSession }) {
      startCalls.push(input.session.id)
      leaseHeld.push(options.leaseProbe ? options.leaseProbe() : false)
      if (options.failWith) {
        throw options.failWith
      }

      const run = createStudioRun({
        ownerId: input.session.ownerId,
        sessionId: input.session.id,
        inputText: 'hi',
        activeAgent: input.session.agentType
      })
      const assistantMessage = createStudioAssistantMessage({
        sessionId: input.session.id,
        agent: input.session.agentType,
        metadata: { runId: run.id }
      })

      let settle: (error?: unknown) => void = () => {}
      const completion = new Promise((resolve, reject) => {
        settle = (error?: unknown) => {
          if (error) {
            reject(error)
            return
          }
          resolve({ run, assistantMessage, text: '' })
        }
      })
      completion.catch(() => {})
      pending.push({
        resolve: () => settle(),
        reject: (error: unknown) => settle(error)
      })

      return {
        run,
        assistantMessage,
        abort: (reason?: string) => {
          abortReasons.push(reason ?? 'Run cancelled')
          settle(new Error(reason ?? 'Run cancelled'))
        },
        completion
      }
    }
  }

  return {
    runtime: runtime as unknown as RunServiceRuntime,
    startCalls,
    leaseHeld,
    abortReasons,
    completeAll: () => {
      for (const entry of pending) {
        entry.resolve()
      }
    },
    failAll: (error: Error = new Error('run failed')) => {
      for (const entry of pending) {
        entry.reject(error)
      }
    }
  }
}

function createMemoryCoordinationService(options: {
  coordinator?: StudioRunCoordinatorPort
  runStore?: StudioRunStore
  eventBus?: StudioEventBus
  scheduler?: ManualStudioRunRenewalScheduler
  logger?: RecordingStudioRunCoordinationLogger
  leaseRenewMs?: number
} = {}) {
  const coordinator = options.coordinator ?? createInMemoryStudioRunCoordinator()
  const scheduler = options.scheduler ?? new ManualStudioRunRenewalScheduler()
  const logger = options.logger ?? new RecordingStudioRunCoordinationLogger()
  const service = new StudioRunCoordinationService({
    coordinator,
    runStore: options.runStore,
    eventBus: options.eventBus,
    logger,
    scheduler,
    leaseRenewMs: options.leaseRenewMs ?? 15_000
  })
  return { coordinator, scheduler, logger, service }
}

/**
 * One in-process backend shared by several coordinator instances, modelling one Redis that two
 * replicas talk to. Independent maps per coordinator cannot model cross-instance exclusion at
 * all, so every spec claiming cross-instance behaviour goes through this shared state.
 */
interface SharedStudioRunBackend {
  readonly leases: Map<string, StudioRunLease>
  readonly cancellations: Map<string, { command: StudioRunCancellationCommand; expiresAt: number }>
  readonly listeners: Set<StudioRunCancellationListener>
  leaseTtlMs: number
  cancellationTtlMs: number
  now: () => number
  createId: () => string
}

function createSharedStudioRunBackend(
  options: { leaseTtlMs?: number; cancellationTtlMs?: number; now?: () => number; createId?: () => string } = {}
): SharedStudioRunBackend {
  let counter = 0
  return {
    leases: new Map(),
    cancellations: new Map(),
    listeners: new Set(),
    leaseTtlMs: options.leaseTtlMs ?? 60_000,
    cancellationTtlMs: options.cancellationTtlMs ?? 3_600_000,
    now: options.now ?? (() => Date.now()),
    createId: options.createId ?? (() => `id-${(counter += 1)}`)
  }
}

/**
 * Adapter-level coordinator over shared state: token-checked leases with expiry, durable
 * cancellation markers, and Pub/Sub-style fan-out to every instance's listener. Two instances
 * over one backend behave like two replicas over one Redis.
 */
function createSharedBackendStudioRunCoordinator(
  backend: SharedStudioRunBackend,
  options: { ownerInstanceId: string; logger?: StudioRunCoordinationLogger }
): StudioRunCoordinatorPort {
  const logger = options.logger
  let listener: StudioRunCancellationListener | null = null
  let closed = false

  function readLiveLease(sessionId: string): StudioRunLease | null {
    const lease = backend.leases.get(sessionId)
    if (!lease) {
      return null
    }
    if (lease.expiresAt <= backend.now()) {
      backend.leases.delete(sessionId)
      return null
    }
    return lease
  }

  function notify(command: StudioRunCancellationCommand): void {
    for (const target of backend.listeners) {
      try {
        target(command)
      } catch (error) {
        // Mirrors the adapters: a throwing listener never breaks the cancellation request.
        logger?.error('Studio Run cancellation listener failed', error instanceof Error ? error.message : String(error))
      }
    }
  }

  return {
    async start(onCancellation: StudioRunCancellationListener): Promise<void> {
      if (closed) {
        throw new Error('Studio Run coordinator is closed')
      }
      if (listener) {
        return
      }
      listener = onCancellation
      backend.listeners.add(onCancellation)
    },

    async tryAcquireSession(sessionId: string): Promise<StudioRunLease | null> {
      if (closed || !listener) {
        throw new Error('Studio Run coordinator is not started')
      }
      if (readLiveLease(sessionId)) {
        return null
      }
      const lease: StudioRunLease = {
        sessionId,
        leaseId: backend.createId(),
        ownerInstanceId: options.ownerInstanceId,
        expiresAt: backend.now() + backend.leaseTtlMs
      }
      backend.leases.set(sessionId, lease)
      return lease
    },

    async renewSession(lease: StudioRunLease): Promise<StudioRunLease | null> {
      const current = readLiveLease(lease.sessionId)
      if (!current || current.leaseId !== lease.leaseId || current.ownerInstanceId !== lease.ownerInstanceId) {
        return null
      }
      const renewed: StudioRunLease = { ...current, expiresAt: backend.now() + backend.leaseTtlMs }
      backend.leases.set(lease.sessionId, renewed)
      return renewed
    },

    async releaseSession(lease: StudioRunLease): Promise<boolean> {
      const current = readLiveLease(lease.sessionId)
      if (!current || current.leaseId !== lease.leaseId || current.ownerInstanceId !== lease.ownerInstanceId) {
        return false
      }
      backend.leases.delete(lease.sessionId)
      return true
    },

    async requestCancellation(runId: string, reason: string): Promise<StudioRunCancellationCommand> {
      if (closed) {
        throw new Error('Studio Run coordinator is closed')
      }
      const command = createStudioRunCancellationCommand({
        runId,
        reason,
        commandId: backend.createId(),
        requestedAt: new Date(backend.now()).toISOString()
      })
      backend.cancellations.set(runId, { command, expiresAt: backend.now() + backend.cancellationTtlMs })
      notify(command)
      return command
    },

    async readCancellation(runId: string): Promise<StudioRunCancellationCommand | null> {
      const stored = backend.cancellations.get(runId)
      if (!stored) {
        return null
      }
      if (stored.expiresAt <= backend.now()) {
        backend.cancellations.delete(runId)
        return null
      }
      // Key and payload must agree, exactly like the Redis adapter's marker read.
      return stored.command.runId === runId ? stored.command : null
    },

    async close(): Promise<void> {
      if (closed) {
        return
      }
      closed = true
      if (listener) {
        backend.listeners.delete(listener)
        listener = null
      }
    }
  }
}

/**
 * Bounded local coordinator double for the concurrency interleavings. It owns a tiny lease-token
 * store (so a token-checked release or renewal can be proven not to affect a newer lease) plus
 * scripted renew behaviour (fail on the Nth call, or suspend until the spec releases it). Modeled
 * here, in the spec file, because `tests/support/**` is outside this correction's allowed scope.
 */
class ScriptedOwnershipCoordinator implements StudioRunCoordinatorPort {
  readonly acquiredSessions: string[] = []
  readonly renewedLeases: StudioRunLease[] = []
  readonly releasedLeases: StudioRunLease[] = []
  readonly liveLeaseIds = new Set<string>()

  private readonly leaseIds: string[]
  private readonly ownerInstanceId: string
  private readonly markers = new Map<string, StudioRunCancellationCommand>()
  private readonly failingRenewCalls = new Set<number>()
  private renewCalls = 0
  private renewReply: (() => Promise<StudioRunLease | null>) | null = null
  private listener: StudioRunCancellationListener | null = null

  constructor(input: { leaseIds: string[]; ownerInstanceId?: string }) {
    this.leaseIds = input.leaseIds
    this.ownerInstanceId = input.ownerInstanceId ?? 'owner-local'
  }

  get renewCallCount(): number {
    return this.renewCalls
  }

  /** Makes renew call `callNumber` (1-based) fail, modelling a transport error in a tick. */
  failRenewCall(callNumber: number): void {
    this.failingRenewCalls.add(callNumber)
  }

  /** Hands the next renew call an externally controlled reply, so the spec can suspend it. */
  useRenewReply(reply: () => Promise<StudioRunLease | null>): void {
    this.renewReply = reply
  }

  /** Models the lease key being lost in Redis and taken by another owner. */
  revoke(leaseId: string): void {
    this.liveLeaseIds.delete(leaseId)
  }

  isHeld(leaseId: string): boolean {
    return this.liveLeaseIds.has(leaseId)
  }

  async start(onCancellation: StudioRunCancellationListener): Promise<void> {
    this.listener = onCancellation
  }

  async tryAcquireSession(sessionId: string): Promise<StudioRunLease | null> {
    this.acquiredSessions.push(sessionId)
    if (this.liveLeaseIds.size > 0) {
      return null
    }
    const leaseId = this.leaseIds[this.acquiredSessions.length - 1]
    if (!leaseId) {
      return null
    }
    this.liveLeaseIds.add(leaseId)
    return { sessionId, leaseId, ownerInstanceId: this.ownerInstanceId, expiresAt: 1_000_000 }
  }

  async renewSession(lease: StudioRunLease): Promise<StudioRunLease | null> {
    this.renewCalls += 1
    this.renewedLeases.push(lease)
    const scripted = this.renewReply
    if (scripted) {
      this.renewReply = null
      return scripted()
    }
    if (this.failingRenewCalls.has(this.renewCalls)) {
      throw new Error('scheduler renewal failed')
    }
    if (!this.liveLeaseIds.has(lease.leaseId)) {
      return null
    }
    return { ...lease, expiresAt: lease.expiresAt + 60_000 }
  }

  async releaseSession(lease: StudioRunLease): Promise<boolean> {
    this.releasedLeases.push(lease)
    if (!this.liveLeaseIds.has(lease.leaseId)) {
      return false
    }
    this.liveLeaseIds.delete(lease.leaseId)
    return true
  }

  async requestCancellation(runId: string, reason: string): Promise<StudioRunCancellationCommand> {
    const command = createStudioRunCancellationCommand({
      runId,
      reason,
      requestedAt: '2026-01-01T00:00:00.000Z'
    })
    this.markers.set(runId, command)
    this.listener?.(command)
    return command
  }

  async readCancellation(runId: string): Promise<StudioRunCancellationCommand | null> {
    return this.markers.get(runId) ?? null
  }

  async close(): Promise<void> {
    this.listener = null
  }
}

/** Run store whose session listing stays pending until the spec resolves it. */
function createDeferredListRunStore(deferred: Deferred<StudioRun[]>): StudioRunStore {
  const base = createInMemoryStudioPersistence()
  return {
    create: (run) => base.runStore.create(run),
    getById: (ownerId, runId) => base.runStore.getById(ownerId, runId),
    update: (ownerId, runId, patch) => base.runStore.update(ownerId, runId, patch),
    transitionStatus: (input) => base.runStore.transitionStatus(input),
    listBySessionId: () => deferred.promise
  }
}

/** Bounded microtask drain for interleavings that must not be awaited to completion. */
async function drainMicrotasks(turns = 25): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve()
  }
}

function createHarness(options: {
  coordination?: StudioRunCoordinationServicePortLike
  runStore?: StudioRunStore
  eventBus?: RecordingEventBus
  stub?: ReturnType<typeof createStubRunRuntime>
} = {}) {
  const persistence = createInMemoryStudioPersistence()
  const eventBus = options.eventBus ?? new RecordingEventBus()
  const stub = options.stub ?? createStubRunRuntime()
  const effectivePersistence: StudioPersistence = options.runStore
    ? { ...persistence, runStore: options.runStore }
    : persistence
  const coordination = options.coordination ?? createMemoryCoordinationService({
    runStore: effectivePersistence.runStore,
    eventBus
  }).service

  const service = createStudioRunService({
    persistence: effectivePersistence,
    runtime: stub.runtime,
    eventBus,
    coordination
  })

  return { service, persistence: effectivePersistence, eventBus, stub, coordination }
}

type StudioRunCoordinationServicePortLike = Parameters<typeof createStudioRunService>[0]['coordination']

function runInput(session: StudioSession) {
  return {
    ownerId: OWNER_ID,
    projectId: 'project-1',
    session,
    inputText: 'draw a circle'
  }
}

function seedRun(input: {
  sessionId: string
  status: StudioRun['status']
  runId?: string
}): StudioRun {
  return {
    id: input.runId ?? `run_${input.sessionId}_${input.status}`,
    ownerId: OWNER_ID,
    sessionId: input.sessionId,
    status: input.status,
    inputText: 'seed',
    activeAgent: 'builder',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

/** Supabase run-table spy that records the conditional transition query it receives. */
function createTransitionSpyClient(input: { row: Record<string, unknown> }) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  let stored: Record<string, unknown> | null = { ...input.row }

  const builder = {
    update(payload: Record<string, unknown>) {
      calls.push({ method: 'update', args: [payload] })
      stored = { ...(stored ?? {}), ...payload }
      return builder
    },
    eq(column: string, value: unknown) {
      calls.push({ method: 'eq', args: [column, value] })
      return builder
    },
    in(column: string, values: unknown) {
      calls.push({ method: 'in', args: [column, values] })
      return builder
    },
    select() {
      calls.push({ method: 'select', args: [] })
      return builder
    },
    maybeSingle() {
      calls.push({ method: 'maybeSingle', args: [] })
      return { data: stored, error: null }
    },
    single() {
      return { data: stored, error: null }
    }
  }

  const client = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] })
      return builder
    }
  }

  return { client: client as unknown as SupabaseClient, calls }
}

function readRepoSource(relativePath: string): string {
  const absolute = path.join(process.cwd(), relativePath)
  assert.ok(fs.existsSync(absolute), `expected repository source at ${absolute}`)
  return fs.readFileSync(absolute, 'utf8')
}

function eventsOfType(events: StudioAgentEvent[], type: StudioAgentEvent['type']): StudioAgentEvent[] {
  return events.filter((event) => event.type === type)
}

export async function runDistributedRunCoordinationTests(): Promise<void> {
  // ---------------------------------------------------------------------------------------
  // Lease primitives
  // ---------------------------------------------------------------------------------------

  // 1.
  await run('session lease: first acquisition wins, a concurrent instance conflicts', async () => {
    // Two adapters over one shared backend: independent maps could never model exclusion.
    const backend = createSharedStudioRunBackend()
    const first = createSharedBackendStudioRunCoordinator(backend, { ownerInstanceId: 'owner-a' })
    const second = createSharedBackendStudioRunCoordinator(backend, { ownerInstanceId: 'owner-b' })
    await first.start(() => {})
    await second.start(() => {})

    const lease = await first.tryAcquireSession('session-1')
    assert.ok(lease, 'the first instance must acquire the session')
    assert.equal(lease.sessionId, 'session-1')
    assert.ok(lease.leaseId.length > 0)

    assert.equal(await second.tryAcquireSession('session-1'), null)
  })

  // 2.
  await run('session lease: different sessions are acquired independently', async () => {
    const backend = createSharedStudioRunBackend()
    const first = createSharedBackendStudioRunCoordinator(backend, { ownerInstanceId: 'owner-a' })
    const second = createSharedBackendStudioRunCoordinator(backend, { ownerInstanceId: 'owner-b' })
    await first.start(() => {})
    await second.start(() => {})

    const leaseA = await first.tryAcquireSession('session-1')
    const leaseB = await second.tryAcquireSession('session-2')

    assert.ok(leaseA && leaseB)
    assert.notEqual(leaseA.leaseId, leaseB.leaseId)
    assert.equal((await first.tryAcquireSession('session-2')), null, 'the other session is still owned')
  })

  // 3.
  await run('session lease: renewal needs the matching token and extends the expiration', async () => {
    let clock = 1_000_000
    const coordinator = createInMemoryStudioRunCoordinator({
      ownerInstanceId: 'owner-a',
      leaseTtlMs: 10_000,
      now: () => clock
    })
    // The adapter contract rejects use before start, so every primitive spec starts first.
    await coordinator.start(() => {})

    const lease = await coordinator.tryAcquireSession('session-1')
    assert.ok(lease)
    clock += 4_000

    const renewed = await coordinator.renewSession(lease)
    assert.ok(renewed, 'the matching token must renew')
    assert.equal(renewed.expiresAt, clock + 10_000)
    assert.ok(renewed.expiresAt > lease.expiresAt)

    assert.equal(await coordinator.renewSession({ ...lease, leaseId: 'other-lease' }), null)
    assert.equal(await coordinator.renewSession({ ...lease, ownerInstanceId: 'owner-b' }), null)
  })

  // 4.
  await run('session lease: release needs the matching token and is idempotent', async () => {
    const coordinator = createInMemoryStudioRunCoordinator({ ownerInstanceId: 'owner-a' })
    await coordinator.start(() => {})
    const lease = await coordinator.tryAcquireSession('session-1')
    assert.ok(lease)

    assert.equal(await coordinator.releaseSession({ ...lease, leaseId: 'other-lease' }), false)
    assert.equal(await coordinator.releaseSession(lease), true)
    assert.equal(await coordinator.releaseSession(lease), false, 'a released lease cannot be released twice')

    // Releasing the wrong token must not free the session.
    await coordinator.tryAcquireSession('session-2')
    assert.equal(await coordinator.releaseSession({ ...lease, sessionId: 'session-2' }), false)
  })

  // 5.
  await run('session lease: an expired lease can be taken over by another instance', async () => {
    let clock = 1_000_000
    // One shared backend with an injected clock: a real takeover, not two disjoint maps.
    const backend = createSharedStudioRunBackend({ leaseTtlMs: 1_000, now: () => clock })
    const first = createSharedBackendStudioRunCoordinator(backend, { ownerInstanceId: 'owner-a' })
    const second = createSharedBackendStudioRunCoordinator(backend, { ownerInstanceId: 'owner-b' })
    await first.start(() => {})
    await second.start(() => {})

    const expired = await first.tryAcquireSession('session-1')
    assert.ok(expired)

    clock += 1_001
    const taken = await second.tryAcquireSession('session-1')
    assert.ok(taken, 'an expired lease must not block a new owner')
    assert.notEqual(taken.leaseId, expired.leaseId)
    assert.equal(taken.ownerInstanceId, 'owner-b')
    assert.equal(await first.renewSession(expired), null, 'the old owner cannot renew an expired lease')
  })

  // ---------------------------------------------------------------------------------------
  // Admission and cleanup
  // ---------------------------------------------------------------------------------------

  // 6.
  await run('admission: two Run services sharing one coordinator admit exactly one Run', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    const session = createSession()

    const persistenceA = createInMemoryStudioPersistence()
    const persistenceB = createInMemoryStudioPersistence()
    const serviceA = new StudioRunCoordinationService({
      coordinator,
      runStore: persistenceA.runStore,
      scheduler: new ManualStudioRunRenewalScheduler()
    })
    const serviceB = new StudioRunCoordinationService({
      coordinator,
      runStore: persistenceB.runStore,
      scheduler: new ManualStudioRunRenewalScheduler()
    })

    const stubA = createStubRunRuntime()
    const stubB = createStubRunRuntime()
    const runServiceA = createStudioRunService({
      persistence: persistenceA,
      runtime: stubA.runtime,
      eventBus: new RecordingEventBus(),
      coordination: serviceA
    })
    const runServiceB = createStudioRunService({
      persistence: persistenceB,
      runtime: stubB.runtime,
      eventBus: new RecordingEventBus(),
      coordination: serviceB
    })

    const started = await runServiceA.startRun(runInput(session))
    assert.equal(started.status, 'started')

    const conflicted = await runServiceB.startRun(runInput(session))
    assert.deepEqual(conflicted, { status: 'conflict' })
    assert.equal(stubB.startCalls.length, 0, 'the losing replica must not create a Run')

    await serviceA.close()
    await serviceB.close()
  })

  // 7.
  await run('admission: the session lease is held before the Run is started', async () => {
    const harnessReady = createMemoryCoordinationService()
    const session = createSession()
    const stub = createStubRunRuntime({
      leaseProbe: () => harnessReady.service.getSessionLease(session.id) !== null
    })
    const persistence = createInMemoryStudioPersistence()
    const service = createStudioRunService({
      persistence,
      runtime: stub.runtime,
      eventBus: new RecordingEventBus(),
      coordination: harnessReady.service
    })

    const started = await service.startRun(runInput(session))
    assert.equal(started.status, 'started')
    assert.deepEqual(stub.leaseHeld, [true], 'the lease must already be held when the Run starts')
    assert.ok(harnessReady.service.getSessionLease(session.id))
  })

  // 8.
  await run('admission: a Run startup failure releases the lease', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const coordination = createMemoryCoordinationService({ coordinator }).service
    const stub = createStubRunRuntime({ failWith: new Error('runtime exploded') })
    const harness = createHarness({ coordination, stub })

    await assert.rejects(() => harness.service.startRun(runInput(createSession())), /runtime exploded/)

    assert.equal(coordinator.releasedLeases.length, 1)
    assert.equal(coordination.getActiveRunIds().length, 0)
    assert.equal(coordinator.acquiredSessions.length, 1)
  })

  // 9.
  await run('admission: completion, failure and cancellation release the lease and the handle', async () => {
    const completed = (() => {
      const coordinator = new FakeStudioRunCoordinator()
      const service = createMemoryCoordinationService({ coordinator }).service
      const harness = createHarness({ coordination: service })
      return { coordinator, harness, service }
    })()

    const session = createSession()
    const started = await completed.harness.service.startRun(runInput(session))
    assert.equal(started.status, 'started')
    assert.equal(completed.service.getActiveRunIds().length, 1)

    completed.harness.stub.completeAll()
    await waitFor(() => completed.service.getActiveRunIds().length === 0)
    assert.equal(completed.coordinator.releasedLeases.length, 1)

    const failed = (() => {
      const coordinator = new FakeStudioRunCoordinator()
      const service = createMemoryCoordinationService({ coordinator }).service
      const harness = createHarness({ coordination: service })
      return { coordinator, harness, service }
    })()
    await failed.harness.service.startRun(runInput(createSession({ title: 'fail' })))
    failed.harness.stub.failAll()
    await waitFor(() => failed.service.getActiveRunIds().length === 0)
    assert.equal(failed.coordinator.releasedLeases.length, 1)

    const cancelled = (() => {
      const coordinator = new FakeStudioRunCoordinator()
      const service = createMemoryCoordinationService({ coordinator }).service
      const harness = createHarness({ coordination: service })
      return { coordinator, harness, service }
    })()
    const cancelledRun = await cancelled.harness.service.startRun(runInput(createSession({ title: 'cancel' })))
    assert.equal(cancelledRun.status, 'started')
    if (cancelledRun.status !== 'started') {
      return
    }
    // A cancellation dispatched by the coordination layer (as another replica would) must end
    // the local Run through the abort path and release the lease.
    const signalled = await cancelled.harness.coordination.requestCancellation({
      runId: cancelledRun.run.id,
      reason: RUN_START_REASON
    })
    assert.equal(signalled.status, 'signalled')
    await waitFor(() => cancelled.service.getActiveRunIds().length === 0)
    assert.deepEqual(cancelled.harness.stub.abortReasons, [RUN_START_REASON])
    assert.equal(cancelled.coordinator.releasedLeases.length, 1)
  })

  // 10.
  await run('admission: different sessions run concurrently', async () => {
    const harness = createHarness()
    const first = await harness.service.startRun(runInput(createSession({ title: 'one' })))
    const second = await harness.service.startRun(runInput(createSession({ title: 'two' })))

    assert.equal(first.status, 'started')
    assert.equal(second.status, 'started')
    assert.equal(harness.stub.startCalls.length, 2)
  })

  // 11.
  await run('admission: a coordination transport failure is not a conflict', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    coordinator.acquireError = new Error('redis unavailable')
    const coordination = createMemoryCoordinationService({ coordinator }).service
    const harness = createHarness({ coordination })

    const result = await harness.service.startRun(runInput(createSession()))

    assert.deepEqual(result, {
      status: 'coordination_unavailable',
      message: STUDIO_RUN_COORDINATION_UNAVAILABLE_MESSAGE
    })
    assert.notEqual(result.status, 'conflict')
    assert.equal(harness.stub.startCalls.length, 0)
  })

  // ---------------------------------------------------------------------------------------
  // Renewal and ownership loss
  // ---------------------------------------------------------------------------------------

  // 12.
  await run('renewal: one scheduler renews every local lease and updates the expiration', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const scheduler = new ManualStudioRunRenewalScheduler()
    const service = createMemoryCoordinationService({ coordinator, scheduler, leaseRenewMs: 5_000 }).service
    const harness = createHarness({ coordination: service })

    const sessionA = createSession({ title: 'a' })
    const sessionB = createSession({ title: 'b' })
    await harness.service.startRun(runInput(sessionA))
    await harness.service.startRun(runInput(sessionB))

    assert.equal(scheduler.scheduleCount, 1, 'leases must share one renewal scheduler')
    assert.equal(scheduler.intervalMs, 5_000)

    const before = service.getSessionLease(sessionA.id)
    assert.ok(before)

    // Admission itself proves ownership with one conditional renew per session, so only the
    // *additional* renewals may be attributed to the scheduler tick.
    const admissionsRenewals = coordinator.renewedLeases.length

    scheduler.runTick()
    await service.whenIdle()

    const after = service.getSessionLease(sessionA.id)
    assert.ok(after)
    assert.ok(after.expiresAt > before.expiresAt, 'the local expiration must move forward')
    assert.equal(
      coordinator.renewedLeases.length - admissionsRenewals,
      2,
      'every owned session must be renewed once per tick'
    )
    assert.equal(coordinator.renewedLeases[admissionsRenewals].leaseId, before.leaseId)
  })

  // 13.
  await run('renewal: a lost lease aborts the owning handle exactly once', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const scheduler = new ManualStudioRunRenewalScheduler()
    const coordination = createMemoryCoordinationService({ coordinator, scheduler }).service
    const harness = createHarness({ coordination })
    const started = await harness.service.startRun(runInput(createSession()))

    assert.equal(started.status, 'started')

    // Ownership is lost *after* admission, so the proof at admission time still succeeds.
    coordinator.renewResult = null
    scheduler.runTick()
    await coordination.whenIdle()
    assert.deepEqual(harness.stub.abortReasons, [STUDIO_RUN_LEASE_LOST_REASON])

    scheduler.runTick()
    await coordination.whenIdle()
    assert.equal(harness.stub.abortReasons.length, 1, 'ownership loss must abort exactly once')
  })

  // 14.
  await run('renewal: a renewal transport error fails closed and aborts exactly once', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const logger = new RecordingStudioRunCoordinationLogger()
    const scheduler = new ManualStudioRunRenewalScheduler()
    const service = createMemoryCoordinationService({ coordinator, scheduler, logger }).service
    const harness = createHarness({ coordination: service })

    await harness.service.startRun(runInput(createSession()))

    // The transport fails only for the scheduled tick, after admission proved ownership.
    coordinator.renewError = new Error('redis gone')
    scheduler.runTick()
    await service.whenIdle()

    assert.deepEqual(harness.stub.abortReasons, [STUDIO_RUN_LEASE_LOST_REASON])
    assert.ok(logger.messages('error').includes('Studio Run lease renewal failed'))

    scheduler.runTick()
    await service.whenIdle()
    assert.equal(harness.stub.abortReasons.length, 1)
  })

  // 15.
  await run('renewal: a release failure is logged, local state is dropped, TTL remains the fallback', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    coordinator.releaseError = new Error('redis gone during release')
    const logger = new RecordingStudioRunCoordinationLogger()
    const service = createMemoryCoordinationService({ coordinator, logger }).service
    const harness = createHarness({ coordination: service })

    const session = createSession()
    await harness.service.startRun(runInput(session))
    harness.stub.completeAll()
    await waitFor(() => service.getActiveRunIds().length === 0)

    assert.ok(logger.messages('warn').includes('Studio Run lease release failed'))
    assert.equal(coordinator.releasedLeases.length, 1)
    assert.equal(service.getSessionLease(session.id), null)
  })

  // ---------------------------------------------------------------------------------------
  // Cross-replica cancellation
  // ---------------------------------------------------------------------------------------

  // 16.
  await run('cancellation: a command from replica B aborts the handle on replica A', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    const session = createSession()
    const persistenceA = createInMemoryStudioPersistence()
    const stubA = createStubRunRuntime()
    const serviceA = new StudioRunCoordinationService({
      coordinator,
      runStore: persistenceA.runStore,
      scheduler: new ManualStudioRunRenewalScheduler()
    })
    const runServiceA = createStudioRunService({
      persistence: persistenceA,
      runtime: stubA.runtime,
      eventBus: new RecordingEventBus(),
      coordination: serviceA
    })

    const persistenceB = createInMemoryStudioPersistence()
    const serviceB = new StudioRunCoordinationService({
      coordinator,
      runStore: persistenceB.runStore,
      scheduler: new ManualStudioRunRenewalScheduler()
    })

    const started = await runServiceA.startRun(runInput(session))
    assert.equal(started.status, 'started')

    const outcome = await serviceB.requestCancellation({ runId: 'run-owned-by-a', reason: RUN_START_REASON })
    assert.equal(outcome.status, 'signalled')
    assert.equal(stubA.abortReasons.length, 0, 'the command belongs to an unknown Run on replica B')

    // The owner's Run id is what the command carries.
    if (started.status === 'started') {
      await serviceB.requestCancellation({ runId: started.run.id, reason: RUN_START_REASON })
      assert.deepEqual(stubA.abortReasons, [RUN_START_REASON])
    }

    await serviceA.close()
    await serviceB.close()
  })

  // 17.
  await run('cancellation: a command arriving before handle attachment is recovered', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const service = createMemoryCoordinationService({ coordinator }).service

    const admission = await service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    assert.equal(admission.status, 'reserved')
    if (admission.status !== 'reserved') {
      return
    }

    const signalled = await service.requestCancellation({ runId: 'run-late', reason: RUN_START_REASON })
    assert.equal(signalled.status, 'signalled')

    const aborts: string[] = []
    const attachment = await service.attachRun({
      reservation: admission.reservation,
      runId: 'run-late',
      abort: (reason?: string) => aborts.push(reason ?? 'Run cancelled')
    })

    assert.equal(attachment.cancelled, true)
    assert.equal(attachment.reason, RUN_START_REASON)
    assert.deepEqual(aborts, [RUN_START_REASON], 'the marker reason must be preserved')
  })

  // 18.
  await run('cancellation: a missed Pub/Sub notification is found during renewal', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const scheduler = new ManualStudioRunRenewalScheduler()
    const service = createMemoryCoordinationService({ coordinator, scheduler }).service
    const aborts: string[] = []

    const admission = await service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    assert.equal(admission.status, 'reserved')
    if (admission.status !== 'reserved') {
      return
    }
    await service.attachRun({
      reservation: admission.reservation,
      runId: 'run-missed',
      abort: (reason?: string) => aborts.push(reason ?? 'Run cancelled')
    })

    // The marker exists, the notification never arrived.
    coordinator.setMarkerWithoutDelivery(
      createStudioRunCancellationCommand({ runId: 'run-missed', reason: RUN_START_REASON })
    )

    const renewalsBeforeTick = coordinator.renewedLeases.length
    scheduler.runTick()
    await service.whenIdle()

    assert.deepEqual(aborts, [RUN_START_REASON])
    assert.equal(
      coordinator.renewedLeases.length,
      renewalsBeforeTick,
      'a cancelled Run must not be renewed by the tick'
    )
  })

  // 19.
  await run('cancellation: malformed or foreign commands are rejected without throwing', async () => {
    const invalidPayloads = [
      '',
      'not-json',
      JSON.stringify([{ version: 1 }]),
      JSON.stringify({ version: 2, commandId: 'c', runId: 'r', reason: 'x', requestedAt: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ version: 1, commandId: 'c', runId: 'r', reason: '', requestedAt: '2026-01-01T00:00:00.000Z' }),
      JSON.stringify({ version: 1, commandId: 'c', runId: 'r', reason: 'x', requestedAt: 'not-a-date' }),
      JSON.stringify({ version: 1, commandId: 'c', runId: 'r', reason: 'x' })
    ]
    for (const payload of invalidPayloads) {
      const decoded = decodeStudioRunCancellationCommand(payload)
      assert.equal(decoded.ok, false, `expected a rejection for ${payload}`)
      if (!decoded.ok) {
        assert.ok(decoded.reason.length > 0)
      }
    }

    const valid = decodeStudioRunCancellationCommand(
      JSON.stringify({ version: 1, commandId: 'c', runId: 'r', reason: 'stop', requestedAt: '2026-01-01T00:00:00.000Z' })
    )
    assert.equal(valid.ok, true)

    // A throwing local listener must not break the cancellation request, and a command for an
    // unknown Run must be ignored by the service.
    const logger = new RecordingStudioRunCoordinationLogger()
    const coordinator = createInMemoryStudioRunCoordinator({ logger })
    await coordinator.start(() => {
      throw new Error('bad listener')
    })
    const command = await coordinator.requestCancellation('run-unknown', RUN_START_REASON)
    assert.equal(command.runId, 'run-unknown')
    assert.ok(logger.messages('error').includes('Studio Run cancellation listener failed'))

    const fake = new FakeStudioRunCoordinator()
    const service = createMemoryCoordinationService({ coordinator: fake }).service
    await service.start()
    fake.deliver(createStudioRunCancellationCommand({ runId: 'run-unknown', reason: RUN_START_REASON }))
    assert.equal(service.getActiveRunIds().length, 0)
  })

  // 20.
  await run('cancellation: repeated requests are idempotent and keep a bounded reason', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const service = createMemoryCoordinationService({ coordinator }).service
    const aborts: string[] = []

    const admission = await service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    if (admission.status !== 'reserved') {
      throw new Error('expected a reservation')
    }
    await service.attachRun({
      reservation: admission.reservation,
      runId: 'run-1',
      abort: (reason?: string) => aborts.push(reason ?? 'Run cancelled')
    })

    const noisyReason = `  stop\n${'because '.repeat(40)}  `
    const first = await service.requestCancellation({ runId: 'run-1', reason: noisyReason })
    const second = await service.requestCancellation({ runId: 'run-1', reason: noisyReason })

    assert.equal(first.status, 'signalled')
    assert.equal(second.status, 'signalled')
    if (first.status !== 'signalled' || second.status !== 'signalled') {
      return
    }

    assert.equal(first.command.reason, second.command.reason)
    assert.ok(first.command.reason.length <= 200)
    assert.equal(/\s{2,}/.test(first.command.reason), false)
    assert.equal(first.command.reason, first.command.reason.trim())
    assert.deepEqual(aborts, [first.command.reason], 'a repeated request must not abort twice')
  })

  // 21.
  await run('cancellation: a marker-write failure reports coordination unavailable', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    coordinator.requestCancellationError = new Error('redis://user:secret@host:6379 lease key')
    const service = createMemoryCoordinationService({ coordinator }).service

    const outcome = await service.requestCancellation({ runId: 'run-1', reason: RUN_START_REASON })
    assert.equal(outcome.status, 'coordination_unavailable')

    const eventBus = new RecordingEventBus()
    const persistence = createInMemoryStudioPersistence()
    const running = seedRun({ sessionId: 'session-1', status: 'running', runId: 'run-1' })
    await persistence.runStore.create(running)

    const harness = createHarness({
      coordination: service,
      runStore: persistence.runStore,
      eventBus,
      stub: createStubRunRuntime()
    })
    const result = await harness.service.cancelRun({ ownerId: OWNER_ID, runId: 'run-1', reason: RUN_START_REASON })

    assert.equal(result.status, 'coordination_unavailable')
    const persisted = await persistence.runStore.getById(OWNER_ID, 'run-1')
    assert.equal(persisted?.status, 'running', 'a failed signal must not claim a cancellation')
    assert.equal(eventBus.events.length, 0)
  })

  // ---------------------------------------------------------------------------------------
  // Atomic terminal transitions
  // ---------------------------------------------------------------------------------------

  // 22.
  await run('transitions: pending/running Runs are transitioned to every terminal status', async () => {
    const store = new InMemoryStudioRunStore()
    const targets: Array<StudioRun['status']> = ['completed', 'failed', 'cancelled']

    for (const target of targets) {
      const run = seedRun({ sessionId: `session-${target}`, status: 'pending', runId: `run-pending-${target}` })
      await store.create(run)
      const applied = await store.transitionStatus({
        ownerId: OWNER_ID,
        runId: run.id,
        from: STUDIO_RUN_ACTIVE_STATUSES,
        patch: { status: target }
      })
      assert.equal(applied.applied, true)
      assert.equal(applied.run?.status, target)

      const running = seedRun({ sessionId: `session-running-${target}`, status: 'running', runId: `run-running-${target}` })
      await store.create(running)
      const fromRunning = await store.transitionStatus({
        ownerId: OWNER_ID,
        runId: running.id,
        from: STUDIO_RUN_ACTIVE_STATUSES,
        patch: { status: target }
      })
      assert.equal(fromRunning.applied, true)
      assert.equal(fromRunning.run?.status, target)
    }
  })

  // 23.
  await run('transitions: cancelled is terminal and cannot be completed or failed', async () => {
    const store = new InMemoryStudioRunStore()
    const run = seedRun({ sessionId: 'session-1', status: 'cancelled', runId: 'run-1' })
    await store.create(run)

    const completed = await store.transitionStatus({
      ownerId: OWNER_ID,
      runId: 'run-1',
      from: STUDIO_RUN_ACTIVE_STATUSES,
      patch: { status: 'completed', completedAt: '2026-01-02T00:00:00.000Z' }
    })
    assert.equal(completed.applied, false)
    assert.equal(completed.run?.status, 'cancelled')

    const failed = await store.transitionStatus({
      ownerId: OWNER_ID,
      runId: 'run-1',
      from: STUDIO_RUN_ACTIVE_STATUSES,
      patch: { status: 'failed' }
    })
    assert.equal(failed.applied, false)
    assert.equal((await store.getById(OWNER_ID, 'run-1'))?.status, 'cancelled')
  })

  // 24.
  await run('transitions: completed and failed are terminal and cannot be cancelled', async () => {
    const store = new InMemoryStudioRunStore()
    for (const status of ['completed', 'failed'] as const) {
      const run = seedRun({ sessionId: `session-${status}`, status, runId: `run-${status}` })
      await store.create(run)
      const result = await store.transitionStatus({
        ownerId: OWNER_ID,
        runId: run.id,
        from: STUDIO_RUN_ACTIVE_STATUSES,
        patch: { status: 'cancelled', error: 'too late' }
      })
      assert.equal(result.applied, false)
      assert.equal(result.run?.status, status)
      assert.equal(result.run?.error, undefined)
    }
  })

  // 25.
  await run('transitions: a cancellation/completion race reports and publishes the winner', async () => {
    const store = new InMemoryStudioRunStore()
    const run = seedRun({ sessionId: 'session-1', status: 'running', runId: 'run-1' })
    await store.create(run)

    const cancelled = await store.transitionStatus({
      ownerId: OWNER_ID,
      runId: 'run-1',
      from: STUDIO_RUN_ACTIVE_STATUSES,
      patch: { status: 'cancelled', error: RUN_START_REASON }
    })
    assert.equal(cancelled.applied, true)

    const late = await store.transitionStatus({
      ownerId: OWNER_ID,
      runId: 'run-1',
      from: STUDIO_RUN_ACTIVE_STATUSES,
      patch: { status: 'completed' }
    })
    assert.equal(late.applied, false)
    assert.equal(late.run?.status, 'cancelled', 'the actual winner must be returned')

    // The real finalization path must publish the persisted winner too.
    const eventBus = new RecordingEventBus()
    const deps = {
      runStore: store,
      messageStore: new InMemoryStudioMessageStore(),
      partStore: new InMemoryStudioPartStore(),
      sharedEventBus: eventBus
    } as unknown as StudioSessionRunnerDependencies

    await assert.rejects(
      () => handleFailedRun(deps, { session: createSession(), run, error: new Error('late failure') }),
      /late failure/
    )

    const published = eventsOfType(eventBus.events, 'run_updated')
    assert.equal(published.length, 1)
    const publishedRun = published[0].type === 'run_updated' ? published[0].run : null
    assert.equal(publishedRun?.status, 'cancelled')
    assert.equal(publishedRun?.error, RUN_START_REASON)
  })

  // 26.
  await run('transitions: the Supabase update carries an expected-status predicate', async () => {
    const spy = createTransitionSpyClient({
      row: {
        id: 'run-1',
        owner_id: OWNER_ID,
        session_id: 'session-1',
        status: 'running',
        input_text: 'seed',
        active_agent: 'builder',
        created_at: '2026-01-01T00:00:00.000Z',
        completed_at: null,
        error: null,
        metadata: null
      }
    })
    const persistence = createSupabaseStudioPersistence(spy.client)

    const result = await persistence.runStore.transitionStatus({
      ownerId: OWNER_ID,
      runId: 'run-1',
      from: STUDIO_RUN_ACTIVE_STATUSES,
      patch: { status: 'completed', completedAt: '2026-01-02T00:00:00.000Z' }
    })

    assert.equal(result.applied, true)
    assert.equal(result.run?.status, 'completed')
    assert.deepEqual(spy.calls[0], { method: 'from', args: ['studio_runs'] })

    const updated = spy.calls.find((call) => call.method === 'update')
    assert.ok(updated)
    assert.equal((updated.args[0] as Record<string, unknown>).status, 'completed')

    const predicate = spy.calls.find((call) => call.method === 'in')
    assert.ok(predicate, 'the status predicate must be part of the write')
    assert.equal(predicate.args[0], 'status')
    assert.deepEqual(predicate.args[1], ['pending', 'running'])
    assert.ok(
      spy.calls.indexOf(predicate) > spy.calls.indexOf(updated),
      'the predicate must be applied to the same update'
    )
  })

  // 27.
  await run('transitions: the in-memory store matches the Supabase transition semantics', async () => {
    const matrix: Array<{ from: StudioRun['status']; to: StudioRun['status'] }> = [
      { from: 'pending', to: 'completed' },
      { from: 'running', to: 'completed' },
      { from: 'running', to: 'failed' },
      { from: 'running', to: 'cancelled' },
      { from: 'cancelled', to: 'completed' },
      { from: 'cancelled', to: 'failed' },
      { from: 'completed', to: 'cancelled' },
      { from: 'failed', to: 'cancelled' }
    ]

    const memoryStore = new InMemoryStudioRunStore()
    const memoryResults: Array<{ applied: boolean; status: StudioRun['status'] | null }> = []
    for (const entry of matrix) {
      const run = seedRun({ sessionId: 'session-1', status: entry.from, runId: `memory-${entry.from}-${entry.to}` })
      await memoryStore.create(run)
      const result = await memoryStore.transitionStatus({
        ownerId: OWNER_ID,
        runId: run.id,
        from: STUDIO_RUN_ACTIVE_STATUSES,
        patch: { status: entry.to }
      })
      memoryResults.push({ applied: result.applied, status: result.run?.status ?? null })
    }

    // The Supabase spy applies the predicate itself, mirroring the SQL `status=in.(...)`.
    const supabaseResults: Array<{ applied: boolean; status: StudioRun['status'] | null }> = []
    for (const entry of matrix) {
      let storedStatus: StudioRun['status'] = entry.from
      const calls: Array<{ method: string; args: unknown[] }> = []
      let pendingStatus: StudioRun['status'] = entry.to
      let applied = false
      const builder = {
        update(payload: Record<string, unknown>) {
          pendingStatus = payload.status as StudioRun['status']
          return builder
        },
        eq() {
          return builder
        },
        in(column: string, values: unknown) {
          calls.push({ method: 'in', args: [column, values] })
          return builder
        },
        select() {
          return builder
        },
        // Mirrors the SQL write: the predicate decides, and only then does the row change.
        maybeSingle() {
          const predicate = calls.find((call) => call.method === 'in')
          const expected = (predicate?.args[1] as StudioRun['status'][] | undefined) ?? []
          applied = expected.includes(storedStatus)
          if (applied) {
            storedStatus = pendingStatus
          }
          return {
            data: applied
              ? { id: 'row', owner_id: OWNER_ID, session_id: 'session-1', status: storedStatus, input_text: 'x', active_agent: 'builder', created_at: '2026-01-01T00:00:00.000Z', completed_at: null, error: null, metadata: null }
              : null,
            error: null
          }
        }
      }
      const client = { from: () => builder }
      const run = seedRun({ sessionId: 'session-1', status: entry.from, runId: `supabase-${entry.from}-${entry.to}` })
      const result = await createSupabaseStudioPersistence(client as unknown as SupabaseClient)
        .runStore
        .transitionStatus({
          ownerId: OWNER_ID,
          runId: run.id,
          from: STUDIO_RUN_ACTIVE_STATUSES,
          patch: { status: entry.to }
        })
      supabaseResults.push({ applied: result.applied, status: result.run?.status ?? null })
    }

    assert.deepEqual(memoryResults, supabaseResults)
  })

  // ---------------------------------------------------------------------------------------
  // Crash recovery
  // ---------------------------------------------------------------------------------------

  // 28.
  await run('recovery: stale pending/running Runs reconcile after the lease is acquired', async () => {
    const persistence = createInMemoryStudioPersistence()
    const eventBus = new RecordingEventBus()
    const session = createSession()
    const stalePending = seedRun({ sessionId: session.id, status: 'pending', runId: 'run-stale-pending' })
    const staleRunning = seedRun({ sessionId: session.id, status: 'running', runId: 'run-stale-running' })
    const finished = seedRun({ sessionId: session.id, status: 'completed', runId: 'run-finished' })
    const cancelled = seedRun({ sessionId: session.id, status: 'cancelled', runId: 'run-cancelled' })
    for (const run of [stalePending, staleRunning, finished, cancelled]) {
      await persistence.runStore.create(run)
    }

    const coordination = createMemoryCoordinationService({
      runStore: persistence.runStore,
      eventBus
    }).service
    const harness = createHarness({ coordination, runStore: persistence.runStore, eventBus })

    const started = await harness.service.startRun(runInput(session))
    assert.equal(started.status, 'started')

    for (const runId of ['run-stale-pending', 'run-stale-running']) {
      const reconciled = await persistence.runStore.getById(OWNER_ID, runId)
      assert.equal(reconciled?.status, 'failed', `${runId} must be reconciled`)
      assert.equal(reconciled?.error, STUDIO_RUN_STALE_OWNER_MESSAGE)
      assert.ok(reconciled?.completedAt)
    }

    const reconciledEvents = eventsOfType(eventBus.events, 'run_updated')
    const reconciledIds = reconciledEvents
      .filter((event) => event.type === 'run_updated')
      .map((event) => (event.type === 'run_updated' ? event.run.id : ''))
    assert.ok(reconciledIds.includes('run-stale-pending'))
    assert.ok(reconciledIds.includes('run-stale-running'))
    assert.equal(harness.stub.startCalls.length, 1)
  })

  // 29.
  await run('recovery: terminal Runs are never reconciled twice', async () => {
    const persistence = createInMemoryStudioPersistence()
    const eventBus = new RecordingEventBus()
    const session = createSession()
    await persistence.runStore.create(seedRun({ sessionId: session.id, status: 'completed', runId: 'run-done' }))
    await persistence.runStore.create(seedRun({ sessionId: session.id, status: 'failed', runId: 'run-failed' }))
    await persistence.runStore.create(seedRun({ sessionId: session.id, status: 'cancelled', runId: 'run-cancelled' }))

    const coordination = createMemoryCoordinationService({ runStore: persistence.runStore, eventBus }).service
    const harness = createHarness({ coordination, runStore: persistence.runStore, eventBus })

    const started = await harness.service.startRun(runInput(session))
    assert.equal(started.status, 'started')

    assert.equal(eventsOfType(eventBus.events, 'run_updated').length, 0)
    for (const runId of ['run-done', 'run-failed', 'run-cancelled']) {
      const run = await persistence.runStore.getById(OWNER_ID, runId)
      assert.ok(run)
      assert.equal(run?.completedAt, undefined)
      assert.equal(run?.error, undefined)
    }
  })

  // 30.
  await run('recovery: a reconciliation failure releases the lease and blocks admission', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const persistence = createInMemoryStudioPersistence()
    const failingStore: StudioRunStore = {
      create: (run) => persistence.runStore.create(run),
      getById: (ownerId, runId) => persistence.runStore.getById(ownerId, runId),
      update: (ownerId, runId, patch) => persistence.runStore.update(ownerId, runId, patch),
      transitionStatus: (input) => persistence.runStore.transitionStatus(input),
      listBySessionId: async () => {
        throw new Error('database unavailable')
      }
    }
    const coordination = createMemoryCoordinationService({ coordinator, runStore: failingStore }).service
    const stub = createStubRunRuntime()
    const service = createStudioRunService({
      persistence: { ...persistence, runStore: failingStore },
      runtime: stub.runtime,
      eventBus: new RecordingEventBus(),
      coordination
    })

    const result = await service.startRun(runInput(createSession()))

    assert.deepEqual(result, {
      status: 'coordination_unavailable',
      message: STUDIO_RUN_COORDINATION_UNAVAILABLE_MESSAGE
    })
    assert.equal(stub.startCalls.length, 0, 'no Run may be created beside an unresolved stale Run')
    assert.equal(coordinator.releasedLeases.length, 1)
  })

  // ---------------------------------------------------------------------------------------
  // Lifecycle, configuration and security
  // ---------------------------------------------------------------------------------------

  // 31.
  await run('config: mode selection, unsafe values and injected prefixes fail fast', async () => {
    const memoryRuntime = createDefaultStudioRunCoordination({
      env: { NODE_ENV: 'test' },
      createCoordinator: () => {
        throw new Error('the memory transport must not build a Redis coordinator')
      }
    })
    assert.equal(memoryRuntime.transport, 'memory')

    let captured: { prefix: string; controlChannel: string; leaseTtlMs: number; cancellationTtlMs: number } | null = null
    const redisRuntime = createDefaultStudioRunCoordination({
      env: {
        NODE_ENV: 'production',
        STUDIO_RUN_REDIS_PREFIX: 'manimcat:production:studio-run:',
        STUDIO_RUN_CONTROL_CHANNEL: 'manimcat:production:studio-run-control',
        STUDIO_RUN_LEASE_TTL_MS: '90000',
        STUDIO_RUN_LEASE_RENEW_MS: '20000',
        STUDIO_RUN_CANCEL_TTL_MS: '120000'
      },
      createCoordinator: (input) => {
        captured = input
        return new FakeStudioRunCoordinator()
      }
    })
    assert.equal(redisRuntime.transport, 'redis')
    assert.deepEqual(captured, {
      prefix: 'manimcat:production:studio-run',
      controlChannel: 'manimcat:production:studio-run-control',
      leaseTtlMs: 90_000,
      cancellationTtlMs: 120_000
    })

    let unknownModeMessage = ''
    try {
      resolveStudioRunCoordinationTransport({ STUDIO_RUN_COORDINATION: 'bogus-mode' })
    } catch (error) {
      unknownModeMessage = error instanceof Error ? error.message : String(error)
    }
    assert.ok(unknownModeMessage.includes('STUDIO_RUN_COORDINATION'))
    assert.equal(unknownModeMessage.includes('bogus-mode'), false, 'unsafe values must not be echoed')

    const invalidConfig: Array<() => unknown> = [
      () => resolveStudioRunLeaseTtlMs({ STUDIO_RUN_LEASE_TTL_MS: '-1' }),
      () => resolveStudioRunLeaseTtlMs({ STUDIO_RUN_LEASE_TTL_MS: 'soon' }),
      () => resolveStudioRunLeaseRenewMs({ STUDIO_RUN_LEASE_TTL_MS: '60000', STUDIO_RUN_LEASE_RENEW_MS: '40000' }, 60_000),
      () => resolveStudioRunCancellationTtlMs({ STUDIO_RUN_CANCEL_TTL_MS: '0' }),
      () => resolveStudioRunRedisPrefix({ STUDIO_RUN_REDIS_PREFIX: 'has whitespace' }),
      () => resolveStudioRunControlChannel({ STUDIO_RUN_CONTROL_CHANNEL: '   ' })
    ]
    for (const invalid of invalidConfig) {
      assert.throws(invalid)
    }

    assert.equal(resolveStudioRunLeaseTtlMs({}), 60_000)
    assert.equal(resolveStudioRunLeaseRenewMs({}, 60_000), 15_000)
    assert.equal(resolveStudioRunCancellationTtlMs({}), 3_600_000)
    assert.equal(resolveStudioRunRedisPrefix({ NODE_ENV: 'production' }), 'manimcat:production:studio-run')
    assert.equal(resolveStudioRunControlChannel({ NODE_ENV: 'production' }), 'manimcat:production:studio-run-control')
  })

  // 32.
  await run('lifecycle: repeated start and close are idempotent', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const scheduler = new ManualStudioRunRenewalScheduler()
    const service = createMemoryCoordinationService({ coordinator, scheduler }).service

    await service.start()
    await service.start()
    assert.equal(coordinator.startCount, 1)

    // A reservation is what installs the renewal loop, so the stop path is observable.
    const admission = await service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    assert.equal(admission.status, 'reserved')

    await service.close()
    await service.close()
    assert.equal(coordinator.closeCount, 1)
    assert.equal(scheduler.isStopped(), true)
    assert.equal(scheduler.scheduleCount, 1)
    await assert.rejects(() => service.start(), /closed/)

    let eventStarts = 0
    let eventCloses = 0
    let coordinationCloses = 0
    const eventRuntime: StudioEventBusRuntime = {
      eventBus: new InMemoryStudioEventBus(),
      transport: 'memory',
      start: async () => {
        eventStarts += 1
      },
      close: async () => {
        eventCloses += 1
      }
    }
    const coordinationRuntime: StudioRunCoordinationRuntime = {
      service,
      transport: 'memory',
      start: async () => undefined,
      close: async () => {
        coordinationCloses += 1
      }
    }
    const infrastructure = createStudioInfrastructureRuntime({ event: eventRuntime, runCoordination: coordinationRuntime })

    await infrastructure.start()
    await infrastructure.start()
    assert.equal(eventStarts, 1)

    await infrastructure.close()
    await infrastructure.close()
    assert.equal(coordinationCloses, 1)
    assert.equal(eventCloses, 1)
  })

  // 33.
  await run('lifecycle: a coordination startup failure rolls back the event transport', async () => {
    const order: string[] = []
    let eventCloses = 0
    const eventRuntime: StudioEventBusRuntime = {
      eventBus: new InMemoryStudioEventBus(),
      transport: 'memory',
      start: async () => {
        order.push('event.start')
      },
      close: async () => {
        order.push('event.close')
        eventCloses += 1
      }
    }
    const service = createMemoryCoordinationService().service
    const coordinationRuntime: StudioRunCoordinationRuntime = {
      service,
      transport: 'memory',
      start: async () => {
        order.push('coordination.start')
        throw new Error('control subscription refused')
      },
      close: async () => {
        order.push('coordination.close')
      }
    }
    const logger = new RecordingStudioRunCoordinationLogger()
    const infrastructure = createStudioInfrastructureRuntime({
      event: eventRuntime,
      runCoordination: coordinationRuntime,
      logger
    })

    await assert.rejects(() => infrastructure.start(), /control subscription refused/)
    assert.deepEqual(order, ['event.start', 'coordination.start', 'event.close'])
    assert.equal(eventCloses, 1)

    // The failure is cached: a retry must not bootstrap the event transport twice.
    await assert.rejects(() => infrastructure.start())
    assert.equal(eventCloses, 1)

    await infrastructure.close()
    assert.equal(eventCloses, 2, 'closing after a failed start must still release the event transport')
  })

  // 34.
  await run('lifecycle: shutdown order is coordination, events, queue, shared Redis', async () => {
    const order: string[] = []
    const eventRuntime: StudioEventBusRuntime = {
      eventBus: new InMemoryStudioEventBus(),
      transport: 'memory',
      start: async () => undefined,
      close: async () => {
        order.push('event.close')
      }
    }
    const service = createMemoryCoordinationService().service
    const coordinationRuntime: StudioRunCoordinationRuntime = {
      service,
      transport: 'memory',
      start: async () => undefined,
      close: async () => {
        order.push('coordination.close')
      }
    }
    const infrastructure = createStudioInfrastructureRuntime({ event: eventRuntime, runCoordination: coordinationRuntime })

    await infrastructure.start()
    await infrastructure.close()
    assert.deepEqual(order, ['coordination.close', 'event.close'])

    const serverSource = readRepoSource('src/server.ts')
    const coordinationClose = serverSource.indexOf('await studioInfrastructureRuntime.close()')
    const queueClose = serverSource.indexOf('await closeQueue()')
    const redisClose = serverSource.indexOf('await redisClient.quit()')
    assert.ok(coordinationClose >= 0 && queueClose > coordinationClose)
    assert.ok(redisClose > queueClose, 'the shared Redis client must quit last')
  })

  // 35.
  await run('security: Redis concerns stay inside the coordination adapter', async () => {
    const directory = path.join(process.cwd(), 'src/studio-agent/run-coordination')
    const modules = fs.readdirSync(directory).filter((entry) => entry.endsWith('.ts')).sort()
    assert.deepEqual(modules, [
      'create-default-studio-run-coordination.ts',
      'in-memory-studio-run-coordinator.ts',
      'index.ts',
      'redis-studio-run-coordinator.ts',
      'studio-infrastructure-runtime.ts',
      'studio-run-cancellation-codec.ts',
      'studio-run-coordination-service.ts',
      'studio-run-coordinator.ts'
    ])

    const redisAware = modules.filter((entry) =>
      readRepoSource(path.join('src/studio-agent/run-coordination', entry)).includes("from '../../config/redis'")
    )
    assert.deepEqual(redisAware, ['redis-studio-run-coordinator.ts'])

    const ioredisAware = modules.filter((entry) =>
      /from 'ioredis'/.test(readRepoSource(path.join('src/studio-agent/run-coordination', entry)))
    )
    assert.deepEqual(ioredisAware, ['redis-studio-run-coordinator.ts'])

    const barrel = readRepoSource('src/studio-agent/index.ts')
    assert.equal(barrel.includes('redis-studio-run-coordinator'), false)
    assert.equal(readRepoSource('src/studio-agent/run-coordination/index.ts').includes("export * from './redis-studio-run-coordinator'"), false)

    const runServiceSource = readRepoSource('src/studio-agent/runtime/run-service.ts')
    for (const forbidden of ['ioredis', 'config/redis', 'setinterval', 'createredis', 'pub/sub', 'redis.call']) {
      assert.equal(runServiceSource.toLowerCase().includes(forbidden), false, `run-service must not contain ${forbidden}`)
    }
  })

  // 36.
  await run('security: control commands never reach Studio SSE or public events', async () => {
    const controlChannel = resolveStudioRunControlChannel({ NODE_ENV: 'production' })
    const eventChannel = resolveStudioEventChannel({ NODE_ENV: 'production' })
    assert.notEqual(controlChannel, eventChannel, 'control traffic needs its own channel')

    const coordinator = new FakeStudioRunCoordinator()
    const eventBus = new RecordingEventBus()
    const service = createMemoryCoordinationService({ coordinator, eventBus }).service

    await service.requestCancellation({ runId: 'run-1', reason: RUN_START_REASON })
    assert.equal(eventBus.events.length, 0, 'a control command must not become a Studio event')

    // The Run-service cancellation path publishes Run state only: never a command payload.
    const persistence = createInMemoryStudioPersistence()
    await persistence.runStore.create(seedRun({ sessionId: 'session-1', status: 'running', runId: 'run-2' }))
    const harness = createHarness({
      coordination: createMemoryCoordinationService({ eventBus }).service,
      runStore: persistence.runStore,
      eventBus
    })
    const result = await harness.service.cancelRun({ ownerId: OWNER_ID, runId: 'run-2', reason: RUN_START_REASON })
    assert.equal(result.status, 'cancelled')

    const published = eventsOfType(eventBus.events, 'run_updated')
    assert.equal(published.length, 1)
    const serialized = JSON.stringify(published[0])
    assert.ok(serialized.includes('cancelled'))
    assert.equal(serialized.includes('commandId'), false)
    assert.equal(serialized.includes('leaseId'), false)

    // The public event codec and DTO layer know nothing about cancellation commands.
    const envelopeSource = readRepoSource('src/studio-agent/events/studio-event-envelope.ts')
    assert.equal(/cancellation/i.test(envelopeSource), false)
    const publicDtoSource = readRepoSource('src/studio-agent/http/public-dto.ts')
    assert.equal(/cancellation|commandId/i.test(publicDtoSource), false)
  })

  // 37.
  await run('security: HTTP maps conflict to 409 and coordination failure to 503', async () => {
    const responses = readRepoSource('src/routes/helpers/studio-agent-responses.ts')
    assert.ok(responses.includes("'SERVICE_UNAVAILABLE'"))
    assert.equal(/WORK_CONFLICT/.test(responses), true)

    const route = readRepoSource('src/routes/studio-agent.route.ts')
    assert.ok(route.includes("sendStudioError(res, 409, 'WORK_CONFLICT'"))
    assert.ok(route.includes("sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', started.message)"))
    assert.ok(route.includes("sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', continued.message"))
    assert.ok(route.includes("sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', cancelled.message"))

    // Infrastructure details never leave the coordination boundary.
    const coordinator = new FakeStudioRunCoordinator()
    coordinator.acquireError = new Error('redis://manimcat:secret@redis:6379 key manimcat:production:studio-run:lease:s1')
    const harness = createHarness({ coordination: createMemoryCoordinationService({ coordinator }).service })
    const result = await harness.service.startRun(runInput(createSession()))

    assert.equal(result.status, 'coordination_unavailable')
    if (result.status !== 'coordination_unavailable') {
      return
    }
    assert.equal(result.message, STUDIO_RUN_COORDINATION_UNAVAILABLE_MESSAGE)
    for (const leak of ['redis://', 'secret', 'lease:', 'command-']) {
      assert.equal(result.message.includes(leak), false, `the message must not leak ${leak}`)
    }
  })

  // 38.
  // Lease/session identifiers are encoded before they can address a Redis key namespace.
  await run('security: Redis key segments are encoded, not interpolated raw', async () => {
    for (const invalid of ['', '   ', 'x'.repeat(201)]) {
      assert.throws(() => encodeStudioRunKeySegment(invalid))
    }
    assert.equal(encodeStudioRunKeySegment('sess-1'), 'sess-1')
    const encoded = encodeStudioRunKeySegment('session:1 cancel')
    assert.equal(encoded.includes(':'), false)
    assert.equal(encoded.includes(' '), false)
    assert.notEqual(encodeStudioRunKeySegment('a%b'), encodeStudioRunKeySegment('a%25b'))
    assert.equal(normalizeStudioRunCancellationReason('  a \n b  '), 'a b')
  })

  // ---------------------------------------------------------------------------------------
  // Review correction specifications
  // ---------------------------------------------------------------------------------------

  // 39.
  await run('transitions: the validator only allows an active source and a terminal target', async () => {
    assert.equal(canTransitionStudioRunStatus([], 'completed'), false, 'an empty source list is refused')
    assert.equal(canTransitionStudioRunStatus(['pending', 'running'], 'running'), false, 'the target must be terminal')
    assert.equal(canTransitionStudioRunStatus(['pending', 'running'], 'pending'), false)
    assert.equal(canTransitionStudioRunStatus(['cancelled'], 'failed'), false, 'a terminal source is refused')
    assert.equal(canTransitionStudioRunStatus(['completed', 'failed'], 'cancelled'), false)
    assert.equal(canTransitionStudioRunStatus(['pending', 'cancelled'], 'completed'), false, 'a mixed source list is refused')
    assert.equal(canTransitionStudioRunStatus(['pending'], 'completed'), true)
    assert.equal(canTransitionStudioRunStatus(['running'], 'failed'), true)
    assert.equal(canTransitionStudioRunStatus(['running'], 'cancelled'), true)

    // Store level: this rule decides whether the conditional write happens at all, which is what
    // keeps terminal persistence reachable (an inverted predicate discarded every terminal write).
    const store = new InMemoryStudioRunStore()
    await store.create(seedRun({ sessionId: 'session-1', status: 'running', runId: 'run-1' }))
    const completed = await store.transitionStatus({
      ownerId: OWNER_ID,
      runId: 'run-1',
      from: STUDIO_RUN_ACTIVE_STATUSES,
      patch: { status: 'completed', completedAt: '2026-01-02T00:00:00.000Z' }
    })
    assert.equal(completed.applied, true)
    assert.equal((await store.getById(OWNER_ID, 'run-1'))?.status, 'completed')

    const empty = await store.transitionStatus({ ownerId: OWNER_ID, runId: 'run-1', from: [], patch: { status: 'failed' } })
    assert.equal(empty.applied, false, 'an empty source list must never mean "any status"')
    assert.equal((await store.getById(OWNER_ID, 'run-1'))?.status, 'completed')
  })

  // 40.
  await run('transitions: a conditional write with no stored Run never publishes a terminal state', async () => {
    const eventBus = new RecordingEventBus()
    const base = createInMemoryStudioPersistence()
    const unidentifiable: StudioRunStore = {
      create: (run) => base.runStore.create(run),
      getById: (ownerId, runId) => base.runStore.getById(ownerId, runId),
      update: (ownerId, runId, patch) => base.runStore.update(ownerId, runId, patch),
      listBySessionId: (ownerId, sessionId) => base.runStore.listBySessionId(ownerId, sessionId),
      transitionStatus: async () => ({ applied: false, run: null })
    }
    const deps = {
      runStore: unidentifiable,
      messageStore: new InMemoryStudioMessageStore(),
      partStore: new InMemoryStudioPartStore(),
      sharedEventBus: eventBus
    } as unknown as StudioSessionRunnerDependencies
    const run = seedRun({ sessionId: 'session-1', status: 'running', runId: 'run-1' })

    // Failure path: the execution error stays primary and the finalization problem becomes its cause.
    const executionError = new Error('execution failed')
    await assert.rejects(
      () => handleFailedRun(deps, { session: createSession(), run, error: executionError }),
      /execution failed/
    )
    assert.equal(eventBus.events.length, 0, 'a Run that was never stored must not be published')
    assert.ok(executionError.cause instanceof Error)
    assert.equal((executionError.cause as Error).message, STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE)

    // Success path: nothing is returned and nothing is published either.
    await assert.rejects(
      () => finalizeSuccessfulRun(deps, {
        session: createSession(),
        run,
        assistantMessage: createStudioAssistantMessage({ sessionId: 'session-1', agent: 'builder' }),
        outcome: 'stop',
        eventBus
      }),
      /could not be persisted/
    )
    assert.equal(eventBus.events.length, 0)

    // Cancellation path: the API refuses to claim a cancellation it could not store.
    const persistence = createInMemoryStudioPersistence()
    const seeded = seedRun({ sessionId: 'session-2', status: 'running', runId: 'run-2' })
    const cancellationStore: StudioRunStore = {
      create: (value) => persistence.runStore.create(value),
      getById: async () => seeded,
      update: (ownerId, runId, patch) => persistence.runStore.update(ownerId, runId, patch),
      listBySessionId: (ownerId, sessionId) => persistence.runStore.listBySessionId(ownerId, sessionId),
      transitionStatus: async () => ({ applied: false, run: null })
    }
    const cancelEventBus = new RecordingEventBus()
    const runService = createStudioRunService({
      persistence: { ...persistence, runStore: cancellationStore },
      runtime: createStubRunRuntime().runtime,
      eventBus: cancelEventBus,
      coordination: createMemoryCoordinationService({ eventBus: cancelEventBus }).service
    })

    const cancelled = await runService.cancelRun({ ownerId: OWNER_ID, runId: 'run-2', reason: RUN_START_REASON })
    assert.equal(cancelled.status, 'coordination_unavailable')
    assert.equal(
      cancelled.status === 'coordination_unavailable' ? cancelled.message : '',
      STUDIO_RUN_FINALIZATION_UNAVAILABLE_MESSAGE
    )
    assert.equal(eventsOfType(cancelEventBus.events, 'run_updated').length, 0, 'no fabricated cancellation may be published')
  })

  // 41.
  await run('recovery: the lease stays renewable while stale-Run reconciliation is pending', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const scheduler = new ManualStudioRunRenewalScheduler()
    const deferred = createDeferred<StudioRun[]>()
    const base = createInMemoryStudioPersistence()
    const store: StudioRunStore = {
      create: (run) => base.runStore.create(run),
      getById: (ownerId, runId) => base.runStore.getById(ownerId, runId),
      update: (ownerId, runId, patch) => base.runStore.update(ownerId, runId, patch),
      transitionStatus: (input) => base.runStore.transitionStatus(input),
      listBySessionId: () => deferred.promise
    }
    const service = createMemoryCoordinationService({ coordinator, scheduler, runStore: store }).service

    let admissionSettled = false
    const admissionPromise = service
      .reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
      .then((result) => {
        admissionSettled = true
        return result
      })

    await waitFor(() => coordinator.acquiredSessions.length === 1 && scheduler.scheduleCount === 1)
    assert.equal(admissionSettled, false, 'the reservation must not be exposed during reconciliation')
    assert.equal(coordinator.renewedLeases.length, 0, 'the ownership proof has not run yet')

    // A tick during the pending reconciliation extends ownership: the lease cannot lapse while
    // a slow reconciliation query is still running.
    scheduler.runTick()
    await service.whenIdle()
    assert.equal(coordinator.renewedLeases.length, 1, 'the provisional lease must be renewable')
    assert.equal(admissionSettled, false)

    deferred.resolve([])
    const admission = await admissionPromise
    assert.equal(admission.status, 'reserved')
    assert.equal(coordinator.releasedLeases.length, 0)
  })

  // 42.
  await run('recovery: ownership lost during reconciliation refuses admission and releases the lease', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const scheduler = new ManualStudioRunRenewalScheduler()
    const deferred = createDeferred<StudioRun[]>()
    const base = createInMemoryStudioPersistence()
    const store: StudioRunStore = {
      create: (run) => base.runStore.create(run),
      getById: (ownerId, runId) => base.runStore.getById(ownerId, runId),
      update: (ownerId, runId, patch) => base.runStore.update(ownerId, runId, patch),
      transitionStatus: (input) => base.runStore.transitionStatus(input),
      listBySessionId: () => deferred.promise
    }
    const service = createMemoryCoordinationService({ coordinator, scheduler, runStore: store }).service

    const admissionPromise = service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    await waitFor(() => coordinator.acquiredSessions.length === 1 && scheduler.scheduleCount === 1)

    // Another replica took the session while reconciliation was pending.
    coordinator.renewResult = null
    scheduler.runTick()
    await service.whenIdle()

    deferred.resolve([])
    const admission = await admissionPromise
    assert.equal(admission.status, 'coordination_unavailable')
    assert.equal(service.getSessionLease('session-1'), null, 'no provisional ownership may remain')
    assert.equal(coordinator.releasedLeases.length, 1, 'the provisional lease must be handed back')
  })

  // 43.
  await run('admission: a scheduler that cannot be installed refuses admission before any work', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const logger = new RecordingStudioRunCoordinationLogger()
    const base = createInMemoryStudioPersistence()
    let listCalls = 0
    const store: StudioRunStore = {
      create: (run) => base.runStore.create(run),
      getById: (ownerId, runId) => base.runStore.getById(ownerId, runId),
      update: (ownerId, runId, patch) => base.runStore.update(ownerId, runId, patch),
      transitionStatus: (input) => base.runStore.transitionStatus(input),
      listBySessionId: async () => {
        listCalls += 1
        return []
      }
    }
    const service = new StudioRunCoordinationService({
      coordinator,
      runStore: store,
      logger,
      scheduler: {
        schedule() {
          throw new Error('no timers available')
        }
      }
    })

    const admission = await service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    assert.equal(admission.status, 'coordination_unavailable', 'a reservation without renewal is unsafe')
    assert.equal(service.getSessionLease('session-1'), null)
    assert.equal(coordinator.releasedLeases.length, 1)
    assert.equal(listCalls, 0, 'reconciliation must not start without a renewal mechanism')
    assert.ok(logger.messages('error').includes('Studio Run lease renewal could not be scheduled'))
  })

  // 44.
  await run('cancellation: a marker for another Run is ignored and oversized fields are rejected', async () => {
    const logger = new RecordingStudioRunCoordinationLogger()
    const coordinator = new FakeStudioRunCoordinator()
    const scheduler = new ManualStudioRunRenewalScheduler()
    const service = createMemoryCoordinationService({ coordinator, scheduler, logger }).service
    const aborts: string[] = []

    const admission = await service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    if (admission.status !== 'reserved') {
      throw new Error('expected a reservation')
    }
    await service.attachRun({
      reservation: admission.reservation,
      runId: 'run-a',
      abort: (reason?: string) => aborts.push(reason ?? 'Run cancelled')
    })

    // Key `run-a` holding a payload that names `run-b` must never abort run-a.
    coordinator.markers.set('run-a', createStudioRunCancellationCommand({ runId: 'run-b', reason: 'for another run' }))
    scheduler.runTick()
    await service.whenIdle()
    assert.deepEqual(aborts, [], 'a marker naming another Run must not abort this one')
    assert.ok(
      logger.messages('warn').includes('Ignoring Studio Run cancellation marker that does not match the requested Run')
    )

    // A matching marker still aborts, so the identity check is not simply ignoring everything.
    coordinator.markers.set('run-a', createStudioRunCancellationCommand({ runId: 'run-a', reason: RUN_START_REASON }))
    scheduler.runTick()
    await service.whenIdle()
    assert.deepEqual(aborts, [RUN_START_REASON])

    const tooLong = 'x'.repeat(201)
    const valid = { version: 1, commandId: 'c', runId: 'r', reason: 'stop', requestedAt: '2026-01-01T00:00:00.000Z' }
    const oversized = [
      { ...valid, commandId: tooLong },
      { ...valid, runId: tooLong },
      { ...valid, reason: '   ' },
      { ...valid, requestedAt: 'x'.repeat(41) },
      { ...valid, requestedAt: 'not-a-date' },
      { ...valid, commandId: 7 }
    ]
    for (const payload of oversized) {
      const decoded = decodeStudioRunCancellationCommand(JSON.stringify(payload))
      assert.equal(decoded.ok, false, `expected a rejection for ${JSON.stringify(payload).slice(0, 60)}`)
      if (!decoded.ok) {
        assert.equal(decoded.reason.includes(tooLong), false, 'a rejection reason must not echo the payload')
      }
    }

    // A long but valid reason is normalized to the documented bound instead of overflowing.
    const normalized = decodeStudioRunCancellationCommand(
      JSON.stringify({ ...valid, reason: `  ${'because '.repeat(40)} ` })
    )
    assert.equal(normalized.ok, true)
    if (normalized.ok) {
      assert.ok(normalized.command.reason.length <= 200)
      assert.equal(/\s{2,}/.test(normalized.command.reason), false)
      assert.equal(normalized.command.reason, normalized.command.reason.trim())
    }
  })

  // 45.
  await run('cancellation: the marker write must acknowledge OK before a cancellation is claimed', async () => {
    assert.doesNotThrow(() => assertStudioRunCancellationMarkerWritten([null, 'OK']))
    assert.throws(() => assertStudioRunCancellationMarkerWritten(undefined), /no reply/)
    assert.throws(() => assertStudioRunCancellationMarkerWritten([null, undefined]), /OK/)
    assert.throws(() => assertStudioRunCancellationMarkerWritten([null, 0]), /OK/)
    assert.throws(() => assertStudioRunCancellationMarkerWritten([null, 'QUEUED']), /OK/)
    assert.throws(() => assertStudioRunCancellationMarkerWritten([new Error('redis://manimcat:secret@redis:6379'), null]), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message.includes('secret'), false, 'the failure message must not carry transport details')
      assert.ok(error.cause instanceof Error, 'the transport error travels as the cause')
      return true
    })

    // The Redis adapter must use this validator on the pipelined marker reply.
    const adapterSource = readRepoSource('src/studio-agent/run-coordination/redis-studio-run-coordinator.ts')
    assert.ok(adapterSource.includes('assertStudioRunCancellationMarkerWritten(results?.[0])'))

    // And the marker read must reject a payload that disagrees with its key.
    const readCancellation = adapterSource.slice(adapterSource.indexOf('async readCancellation'))
    assert.ok(readCancellation.includes('decoded.command.runId !== runId'))
    assert.equal(/logger\.warn\([^)]*payload/.test(adapterSource), false, 'logs must not carry raw payloads')
  })

  // 46.
  await run('admission: a stale provisional rollback never removes a newer local entry', async () => {
    const coordinator = new ScriptedOwnershipCoordinator({ leaseIds: ['lease-a', 'lease-b'] })
    const scheduler = new ManualStudioRunRenewalScheduler()
    const deferredReconcile = createDeferred<StudioRun[]>()
    const base = createInMemoryStudioPersistence()
    let listCalls = 0
    const store: StudioRunStore = {
      create: (run) => base.runStore.create(run),
      getById: (ownerId, runId) => base.runStore.getById(ownerId, runId),
      update: (ownerId, runId, patch) => base.runStore.update(ownerId, runId, patch),
      transitionStatus: (input) => base.runStore.transitionStatus(input),
      listBySessionId: () => {
        listCalls += 1
        // Only admission A is suspended; admission B reconciles immediately.
        return listCalls === 1 ? deferredReconcile.promise : Promise.resolve([])
      }
    }
    const service = new StudioRunCoordinationService({ coordinator, runStore: store, scheduler })

    // 1. Admission A is suspended in reconciliation and holds `lease-a`.
    const admissionA = service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    await waitFor(() => listCalls === 1 && scheduler.scheduleCount === 1)
    assert.equal(service.getSessionLease('session-1')?.leaseId, 'lease-a')

    // 2. A loses its lease: the key expired in Redis and another owner took the session.
    coordinator.revoke('lease-a')

    // 3. A newer local entry B for the same session is installed and attaches its Run.
    const admissionB = await service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    assert.equal(admissionB.status, 'reserved')
    if (admissionB.status !== 'reserved') {
      return
    }
    assert.equal(service.getSessionLease('session-1')?.leaseId, 'lease-b')
    await service.attachRun({ reservation: admissionB.reservation, runId: 'run-b', abort: () => {} })
    assert.deepEqual(service.getActiveRunIds(), ['run-b'])

    // 4. A resumes, reconciles and rolls back.
    deferredReconcile.resolve([])
    const admissionAResult = await admissionA
    assert.equal(admissionAResult.status, 'coordination_unavailable')

    // 5. B is still registered, still owns its Run mapping and is still renewable.
    assert.equal(service.getSessionLease('session-1')?.leaseId, 'lease-b', 'a stale rollback must not remove B')
    assert.deepEqual(service.getActiveRunIds(), ['run-b'], 'a stale rollback must not drop a newer Run mapping')
    scheduler.runTick()
    await service.whenIdle()
    assert.equal(service.getSessionLease('session-1')?.leaseId, 'lease-b')
    const lastRenewed = coordinator.renewedLeases[coordinator.renewedLeases.length - 1]
    assert.equal(lastRenewed.leaseId, 'lease-b', 'B must still be renewable after A rolled back')

    // 6. A's token release cannot release B's lease.
    assert.deepEqual(coordinator.releasedLeases.map((lease) => lease.leaseId), ['lease-a'])
    assert.equal(coordinator.isHeld('lease-b'), true, 'a stale rollback must not release the newer lease')
  })

  // 47.
  await run('admission: a failed scheduler renewal is never overtaken by the ownership proof', async () => {
    const coordinator = new ScriptedOwnershipCoordinator({ leaseIds: ['lease-a'] })
    const scheduler = new ManualStudioRunRenewalScheduler()
    const logger = new RecordingStudioRunCoordinationLogger()
    const deferredReconcile = createDeferred<StudioRun[]>()
    const service = new StudioRunCoordinationService({
      coordinator,
      runStore: createDeferredListRunStore(deferredReconcile),
      scheduler,
      logger
    })
    coordinator.failRenewCall(1)

    const admissionPromise = service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    await waitFor(() => scheduler.scheduleCount === 1 && coordinator.renewCallCount === 0)

    // The scheduler fails first and declares the entry unsafe while admission is still awaiting
    // reconciliation; a successful reply stays available for the proof.
    scheduler.runTick()
    await service.whenIdle()
    assert.equal(coordinator.renewCallCount, 1)

    deferredReconcile.resolve([])
    const admission = await admissionPromise
    assert.equal(admission.status, 'coordination_unavailable')
    assert.equal(
      coordinator.renewCallCount,
      1,
      'the proof must not overtake the failed scheduler renewal and renew anyway'
    )
    assert.equal(service.getSessionLease('session-1'), null)
    assert.equal(coordinator.releasedLeases.length, 1)
    assert.ok(logger.messages('error').includes('Studio Run lease renewal failed'))
  })

  // 48.
  await run('admission: proof renewal and scheduled renewal share one serialized lane', async () => {
    const coordinator = new ScriptedOwnershipCoordinator({ leaseIds: ['lease-a'] })
    const scheduler = new ManualStudioRunRenewalScheduler()
    const deferredReconcile = createDeferred<StudioRun[]>()
    const proofRenewal = createDeferred<StudioRunLease | null>()
    const service = new StudioRunCoordinationService({
      coordinator,
      runStore: createDeferredListRunStore(deferredReconcile),
      scheduler
    })
    coordinator.useRenewReply(() => proofRenewal.promise)

    const admissionPromise = service.reserveSession({ ownerId: OWNER_ID, sessionId: 'session-1' })
    await waitFor(() => scheduler.scheduleCount === 1)

    // The proof reaches the coordinator and suspends there.
    deferredReconcile.resolve([])
    await drainMicrotasks()
    assert.equal(coordinator.renewCallCount, 1)

    // A tick fired while the proof is in flight queues behind it instead of racing it.
    scheduler.runTick()
    await drainMicrotasks()
    assert.equal(coordinator.renewCallCount, 1, 'the tick must not renew concurrently with the proof')

    // The proof fails: admission is refused and the queued tick finds nothing left to renew.
    proofRenewal.reject(new Error('redis gone'))
    const admission = await admissionPromise
    await service.whenIdle()
    assert.equal(admission.status, 'coordination_unavailable')
    assert.equal(coordinator.renewCallCount, 1)
    assert.equal(service.getSessionLease('session-1'), null)
    assert.equal(coordinator.releasedLeases.length, 1)
  })

  // 49.
  await run('cancellation: an oversized raw envelope is rejected before it is parsed', async () => {
    const pad = (length: number) =>
      JSON.stringify({
        version: 1,
        commandId: 'c',
        runId: 'r',
        reason: 'stop',
        requestedAt: '2026-01-01T00:00:00.000Z',
        pad: 'p'.repeat(length)
      })
    const base = pad(0)

    // A syntactically valid JSON envelope that is far larger than any legal command.
    const oversizedButValidJson = JSON.stringify({
      version: 1,
      commandId: 'c'.repeat(1_024),
      runId: 'run-1',
      reason: 'stop',
      requestedAt: '2026-01-01T00:00:00.000Z'
    })
    assert.ok(oversizedButValidJson.length > STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH)
    const decoded = decodeStudioRunCancellationCommand(oversizedButValidJson)
    assert.equal(decoded.ok, false)
    if (!decoded.ok) {
      assert.equal(decoded.reason, 'cancellation command exceeds the payload length limit')
      assert.equal(decoded.reason.includes('c'.repeat(32)), false, 'a rejection reason must not echo the payload')
    }

    // The bound is exact: one byte over is rejected by length, exactly at the bound decodes.
    const oneByteOver = pad(STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH - base.length + 1)
    assert.equal(oneByteOver.length, STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH + 1)
    const overDecoded = decodeStudioRunCancellationCommand(oneByteOver)
    assert.equal(overDecoded.ok, false)
    if (!overDecoded.ok) {
      assert.equal(overDecoded.reason, 'cancellation command exceeds the payload length limit')
    }
    const atBound = pad(STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH - base.length)
    assert.equal(atBound.length, STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH)
    assert.equal(decodeStudioRunCancellationCommand(atBound).ok, true)

    // And the bound must be applied before `trim()` and before `JSON.parse()`.
    const codecSource = readRepoSource('src/studio-agent/run-coordination/studio-run-cancellation-codec.ts')
    const boundIndex = codecSource.indexOf('raw.length > STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH')
    const trimIndex = codecSource.indexOf('!raw.trim()')
    const parseIndex = codecSource.indexOf('JSON.parse(raw)')
    assert.ok(boundIndex >= 0, 'the raw payload bound must exist')
    assert.ok(trimIndex > boundIndex, 'the bound must precede trim()')
    assert.ok(parseIndex > boundIndex, 'the bound must precede JSON.parse()')
  })
}
