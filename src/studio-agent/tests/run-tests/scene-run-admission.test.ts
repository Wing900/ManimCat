/**
 * Task 11B2A focused specifications: Scene-scoped Run admission and distributed coordination.
 *
 * Write-only deliverable of Task 11B2A: this file is authored, registered in `run-tests.ts`,
 * and deliberately NOT executed by the task. Every spec uses injected clocks, controlled
 * deferred promises, fake stores and a fake Redis command surface: no sleeps, no network, no
 * Redis process, no Docker, no PostgreSQL, no Python and no model calls.
 *
 * The conflict matrix under test is hierarchical:
 *
 *   Session Admission State
 *   ├─ Legacy Holder    at most 1, excludes every Scene of that Session
 *   └─ Scene Holders    at most 1 per Scene, siblings run concurrently
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  createLegacyRunExecutionScope,
  InMemoryStudioEventBus,
  InMemoryStudioRenderStore,
  STUDIO_RUN_COORDINATION_UNAVAILABLE_MESSAGE,
  STUDIO_RUN_LEASE_LOST_REASON,
  StudioBuilderRuntime,
  StudioRunCoordinationService,
  StudioToolRegistry,
  buildStudioRenderContext,
  canonicalStudioRunScopeKey,
  createInMemoryStudioPersistence,
  createInMemoryStudioRunCoordinator,
  createLegacyStudioRunScope,
  createSceneStudioRunScope,
  createStudioAssistantMessage,
  createStudioRun,
  createStudioRunService,
  createStudioScene,
  createStudioSession,
  resolveStudioRunCoordinationTransport,
  resolveStudioRunLeaseRenewMs,
  resolveStudioRunLeaseTtlMs,
  studioRunScopeAdmissionField,
  serializeStudioRunLeaseToken,
  type StudioModelPort,
  type StudioPersistence,
  type StudioRun,
  type StudioRunCoordinationScope,
  type StudioRunCoordinatorPort,
  type StudioRunStore,
  type StudioRunTransitionInput,
  type StudioRunTransitionResult,
  type StudioRuntimeBackedToolContext,
  type StudioScene,
  type StudioSession
} from '../../index'
import { createStudioRenderTool } from '../../tools/render-tool'
import { createPlotStudioRenderTool } from '../../plot/tools/plot-render-tool'
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
// Sources are read from the repository root, exactly as the other source-inspection specs do.
const COORDINATION_SOURCE = path.join(
  process.cwd(),
  'src',
  'studio-agent',
  'run-coordination',
  'redis-studio-run-coordinator.ts'
)

function createSession(overrides: { title?: string } = {}): StudioSession {
  return createStudioSession({
    projectId: 'project-1',
    ownerId: OWNER_ID,
    agentType: 'builder',
    title: overrides.title ?? 'Scene admission',
    directory: 'C:/tmp/studio-workspace'
  })
}

function memoryService<C extends StudioRunCoordinatorPort = ReturnType<typeof createInMemoryStudioRunCoordinator>>(options: {
  coordinator?: C
  runStore?: StudioRunStore
  eventBus?: RecordingEventBus
  scheduler?: ManualStudioRunRenewalScheduler
  logger?: RecordingStudioRunCoordinationLogger
  leaseRenewMs?: number
  now?: () => number
} = {}) {
  const coordinator = (options.coordinator ?? createInMemoryStudioRunCoordinator()) as C
  const scheduler = options.scheduler ?? new ManualStudioRunRenewalScheduler()
  const logger = options.logger ?? new RecordingStudioRunCoordinationLogger()
  const service = new StudioRunCoordinationService({
    coordinator: coordinator as never,
    runStore: options.runStore,
    eventBus: options.eventBus,
    logger,
    scheduler,
    leaseRenewMs: options.leaseRenewMs ?? 15_000,
    now: options.now
  })
  return { coordinator, scheduler, logger, service }
}

/** Run store spy: counts which listing each admission used and records every transition. */
class RecordingRunStore implements StudioRunStore {
  readonly listBySceneCalls: Array<{ ownerId: string; sceneId: string }> = []
  readonly listBySessionCalls: Array<{ ownerId: string; sessionId: string }> = []
  readonly transitions: StudioRunTransitionInput[] = []

  constructor(
    private readonly base: StudioRunStore,
    private readonly options: {
      transitionOverride?: (input: StudioRunTransitionInput) => Promise<StudioRunTransitionResult>
    } = {}
  ) {}

  create(run: StudioRun): Promise<StudioRun> {
    return this.base.create(run)
  }

  getById(ownerId: string, runId: string): Promise<StudioRun | null> {
    return this.base.getById(ownerId, runId)
  }

  update(ownerId: string, runId: string, patch: Partial<StudioRun>): Promise<StudioRun | null> {
    return this.base.update(ownerId, runId, patch)
  }

  transitionStatus(input: StudioRunTransitionInput): Promise<StudioRunTransitionResult> {
    this.transitions.push(input)
    return this.options.transitionOverride ? this.options.transitionOverride(input) : this.base.transitionStatus(input)
  }

  listBySessionId(ownerId: string, sessionId: string): Promise<StudioRun[]> {
    this.listBySessionCalls.push({ ownerId, sessionId })
    return this.base.listBySessionId(ownerId, sessionId)
  }

  listBySceneId(ownerId: string, sceneId: string): Promise<StudioRun[]> {
    this.listBySceneCalls.push({ ownerId, sceneId })
    return this.base.listBySceneId(ownerId, sceneId)
  }
}

/** Run store whose Scene listing stays pending until the spec resolves it. */
function createDeferredSceneListRunStore(ownerId: string, deferred: Deferred<StudioRun[]>): StudioRunStore {
  const base = createInMemoryStudioPersistence().runStore
  return {
    create: (run) => base.create(run),
    getById: (id, runId) => base.getById(id, runId),
    update: (id, runId, patch) => base.update(id, runId, patch),
    transitionStatus: (input) => base.transitionStatus(input),
    listBySceneId: () => deferred.promise,
    listBySessionId: () => base.listBySessionId(ownerId, 'session-1')
  }
}

function createStubRunRuntime(options: { leaseProbe?: () => boolean; failWith?: Error } = {}) {
  const inputs: Array<{ sessionId: string; sceneId?: string }> = []
  const leaseHeld: boolean[] = []
  const abortReasons: string[] = []

  const runtime = {
    async startBackgroundRun(input: { session: StudioSession; sceneId?: string }) {
      inputs.push({ sessionId: input.session.id, sceneId: input.sceneId })
      leaseHeld.push(options.leaseProbe ? options.leaseProbe() : false)
      if (options.failWith) {
        throw options.failWith
      }
      const run = createStudioRun({
        ownerId: input.session.ownerId,
        sessionId: input.session.id,
        sceneId: input.sceneId,
        inputText: 'scoped input',
        activeAgent: input.session.agentType
      })
      const assistantMessage = createStudioAssistantMessage({
        sessionId: input.session.id,
        sceneId: input.sceneId,
        agent: input.session.agentType
      })
      let settle: (error?: unknown) => void = () => {}
      const completion = new Promise((resolve, reject) => {
        settle = (error?: unknown) => (error ? reject(error) : resolve({ run, assistantMessage, text: '' }))
      })
      completion.catch(() => {})
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

  return { runtime: runtime as never, inputs, leaseHeld, abortReasons }
}

function createRunServiceHarness<C extends StudioRunCoordinatorPort = ReturnType<typeof createInMemoryStudioRunCoordinator>>(
  options: { coordinator?: C; runStore?: StudioRunStore; stub?: ReturnType<typeof createStubRunRuntime> } = {}
) {
  const persistence = createInMemoryStudioPersistence()
  const eventBus = new RecordingEventBus()
  const stub = options.stub ?? createStubRunRuntime()
  const effective: StudioPersistence = options.runStore ? { ...persistence, runStore: options.runStore } : persistence
  const coordination = memoryService<C>({ coordinator: options.coordinator, runStore: effective.runStore, eventBus })
  const service = createStudioRunService({
    persistence: effective,
    runtime: stub.runtime,
    eventBus,
    coordination: coordination.service
  })
  return { service, persistence: effective, eventBus, stub, coordination }
}

/** Seeds one Scene through the real store, so `getById` behaviour is the production one. */
async function seedScene(
  persistence: StudioPersistence,
  session: StudioSession,
  position: number
): Promise<StudioScene> {
  return persistence.sceneStore.create(
    createStudioScene({
      ownerId: session.ownerId,
      sessionId: session.id,
      position,
      sourcePath: `scenes/scene_${position}.py`
    })
  )
}

async function drainMicrotasks(turns = 25): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve()
  }
}

/** Fake Redis command surface: records what a real server would have been asked to do. */
class FakeRedisCommandSurface {
  readonly evals: Array<{ script: string; keys: string[]; args: string[] }> = []
  evalReply: unknown = 1

  async eval(script: string, numberOfKeys: number, ...rest: unknown[]): Promise<unknown> {
    this.evals.push({
      script,
      keys: rest.slice(0, numberOfKeys).map(String),
      args: rest.slice(numberOfKeys).map(String)
    })
    return this.evalReply
  }

  on(): this {
    return this
  }

  removeAllListeners(): this {
    return this
  }

  async subscribe(): Promise<number> {
    return 1
  }

  disconnect(): void {}
}

function createToolContext(studioKind: 'manim' | 'plot', sceneId?: string): StudioRuntimeBackedToolContext {
  const session = createSession({ title: `${studioKind} render scope` })
  return {
    projectId: session.projectId,
    session,
    run: createStudioRun({
      ownerId: session.ownerId,
      sessionId: session.id,
      sceneId,
      inputText: 'render it',
      activeAgent: 'builder'
    }),
    assistantMessage: createStudioAssistantMessage({ sessionId: session.id, sceneId, agent: 'builder' }),
    eventBus: new InMemoryStudioEventBus(),
    renderStore: new InMemoryStudioRenderStore(),
    executionScope: createLegacyRunExecutionScope({ rootDirectory: session.directory })
  }
}

export async function runSceneRunAdmissionTests(): Promise<void> {
  const scopeA = () => createSceneStudioRunScope('session-1', 'scene-a')
  const scopeB = () => createSceneStudioRunScope('session-1', 'scene-b')

  // ---------------------------------------------------------------------------------------
  // 1-11: conflict matrix and atomic in-memory adapter
  // ---------------------------------------------------------------------------------------

  // 1.
  await run('scene admission: a Legacy holder blocks another Legacy acquire', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    await coordinator.start(() => {})

    const first = await coordinator.tryAcquire(createLegacyStudioRunScope('session-1'))
    assert.ok(first)
    assert.equal(await coordinator.tryAcquire(createLegacyStudioRunScope('session-1')), null)
  })

  // 2.
  await run('scene admission: a Legacy holder blocks every Scene acquire of its Session', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    await coordinator.start(() => {})

    assert.ok(await coordinator.tryAcquire(createLegacyStudioRunScope('session-1')))
    assert.equal(await coordinator.tryAcquire(scopeA()), null)
    assert.equal(await coordinator.tryAcquire(scopeB()), null)
    // Another Session is untouched by that Legacy holder.
    assert.ok(await coordinator.tryAcquire(createLegacyStudioRunScope('session-2')))
  })

  // 3.
  await run('scene admission: any live Scene holder blocks the Legacy acquire', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    await coordinator.start(() => {})

    assert.ok(await coordinator.tryAcquire(scopeA()))
    assert.equal(await coordinator.tryAcquire(createLegacyStudioRunScope('session-1')), null)
  })

  // 4.
  await run('scene admission: the same Scene conflicts across two services', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    const first = memoryService({ coordinator, scheduler: new ManualStudioRunRenewalScheduler() }).service
    const second = memoryService({ coordinator, scheduler: new ManualStudioRunRenewalScheduler() }).service

    const admission = await first.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    assert.equal(admission.status, 'reserved')
    assert.equal((await second.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })).status, 'conflict')
  })

  // 5.
  await run('scene admission: sibling Scenes acquire concurrently', async () => {
    const { service } = memoryService()

    const admissionA = await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    const admissionB = await service.reserveScope({ ownerId: OWNER_ID, scope: scopeB() })
    assert.equal(admissionA.status, 'reserved')
    assert.equal(admissionB.status, 'reserved')
    assert.equal(service.getHeldScopeCount(), 2)
  })

  // 6.
  await run('scene admission: the same Scene id under another Session has independent state', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    await coordinator.start(() => {})

    assert.ok(await coordinator.tryAcquire(createSceneStudioRunScope('session-1', 'scene-a')))
    assert.ok(await coordinator.tryAcquire(createSceneStudioRunScope('session-2', 'scene-a')))
  })

  // 7.
  await run('scene admission: an expired Legacy holder is pruned and a Scene acquire succeeds', async () => {
    let clock = 1_000_000
    const coordinator = createInMemoryStudioRunCoordinator({ leaseTtlMs: 1_000, now: () => clock })
    await coordinator.start(() => {})

    assert.ok(await coordinator.tryAcquire(createLegacyStudioRunScope('session-1')))
    assert.equal(await coordinator.tryAcquire(scopeA()), null, 'a live Legacy holder conflicts')

    clock += 1_001
    assert.ok(await coordinator.tryAcquire(scopeA()), 'an expired Legacy holder must be pruned first')
  })

  // 8.
  await run('scene admission: an expired Scene holder is pruned and Legacy acquire succeeds', async () => {
    let clock = 1_000_000
    const coordinator = createInMemoryStudioRunCoordinator({ leaseTtlMs: 1_000, now: () => clock })
    await coordinator.start(() => {})

    assert.ok(await coordinator.tryAcquire(scopeA()))
    clock += 1_001
    assert.ok(
      await coordinator.tryAcquire(createLegacyStudioRunScope('session-1')),
      'no sibling remains, so Legacy must be admitted once the Scene expired'
    )
  })

  // 9.
  await run('scene admission: expiring one Scene leaves a live sibling intact', async () => {
    let clock = 1_000_000
    const coordinator = createInMemoryStudioRunCoordinator({ leaseTtlMs: 1_000, now: () => clock })
    await coordinator.start(() => {})

    const holderA = await coordinator.tryAcquire(scopeA())
    const holderB = await coordinator.tryAcquire(scopeB())
    assert.ok(holderA && holderB)

    clock += 1_001
    const reacquiredA = await coordinator.tryAcquire(scopeA())
    assert.ok(reacquiredA, 'the expired Scene is free again')
    assert.equal(await coordinator.tryAcquire(scopeB()), null, 'the live sibling is untouched')
    assert.ok(await coordinator.renew(holderB), 'the live sibling can still renew')
  })

  // 10.
  await run('scene admission: renew and release reject a foreign lease token', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    await coordinator.start(() => {})

    const holder = await coordinator.tryAcquire(scopeA())
    assert.ok(holder)

    const foreignScope = { ...holder, scope: scopeB() }
    assert.equal(await coordinator.renew(foreignScope), null, 'a token may not move a sibling Scene')
    assert.equal(await coordinator.release(foreignScope), false, 'a token may not release a sibling Scene')

    const foreignOwner = { ...holder, ownerInstanceId: 'other-replica' }
    assert.equal(await coordinator.renew(foreignOwner), null)
    assert.equal(await coordinator.release(foreignOwner), false)

    assert.ok(await coordinator.renew(holder), 'the real owner still holds its own scope')
    assert.equal(await coordinator.release(holder), true)
  })

  // 11.
  await run('scene admission: releasing Scene A never removes Scene B', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    await coordinator.start(() => {})

    const holderA = await coordinator.tryAcquire(scopeA())
    const holderB = await coordinator.tryAcquire(scopeB())
    assert.ok(holderA && holderB)

    assert.equal(await coordinator.release(holderA), true)
    assert.ok(await coordinator.tryAcquire(scopeA()), 'A is free again')
    assert.equal(await coordinator.tryAcquire(scopeB()), null, 'B is still held')
    assert.ok(await coordinator.renew(holderB))
  })

  // 12.
  await run('scene admission: the Redis scripts use TIME and never KEYS or SCAN', async () => {
    const source = fs.readFileSync(COORDINATION_SOURCE, 'utf8')
    const called = (command: string) => new RegExp(`redis\\.call\\(\\s*'${command}'`).test(source)

    assert.ok(called('TIME'), 'expiry must be decided by Redis server time')
    assert.equal(called('KEYS'), false, 'the keyspace must never be enumerated')
    assert.equal(called('SCAN'), false, 'the keyspace must never be scanned')
    assert.ok(called('HGETALL'), 'the bounded holder set is pruned in place')
    assert.equal(source.includes('KEYS[1]') && source.includes('KEYS[2]'), true, 'only the Lua key array')
    assert.equal(/\.keys\(/.test(source), false, 'the adapter must not call KEYS through the client')
    assert.equal(/\.scan\(|\.scanStream\(/.test(source), false, 'the adapter must not scan the keyspace')
  })

  // 13.
  await run('scene admission: the Redis admission keys share one cluster hash tag', async () => {
    const source = fs.readFileSync(COORDINATION_SOURCE, 'utf8')
    const tag = source.match(/const tag = `\{([^`]+)\}`/)
    assert.ok(tag, 'the hash tag must be built in one place')
    assert.match(tag[1], /encodeStudioRunKeySegment\(sessionId\)/)
    assert.equal(
      (source.match(/:\$\{tag\}:leases/g) ?? []).length,
      1,
      'the HASH key interpolates the shared tag'
    )
    assert.equal(
      (source.match(/:\$\{tag\}:expiry/g) ?? []).length,
      1,
      'the ZSET key interpolates the shared tag'
    )
    // Both keys are built from one prefix and one namespace, so they cannot drift apart.
    assert.equal((source.match(/\$\{prefix\}:\$\{STUDIO_RUN_ADMISSION_NAMESPACE\}/g) ?? []).length, 2)
  })

  // 14.
  await run('scene admission: an unexpected Redis reply fails closed as coordination unavailable', async () => {
    const source = fs.readFileSync(COORDINATION_SOURCE, 'utf8')
    assert.match(
      source,
      /Number\(reply\) !== 1\) \{\s*throw new Error\('Studio Run admission returned an unexpected reply'\)/
    )
    assert.equal(/Number\(reply\) === 0\) \{\s*return null/.test(source), true, '0 stays a genuine conflict')

    // Behavioural counterpart at the layer that turns a thrown acquire into an admission result.
    const coordinator = new FakeStudioRunCoordinator()
    coordinator.acquireError = new Error('unexpected acquisition reply')
    const { service } = memoryService({ coordinator })
    const admission = await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    assert.equal(admission.status, 'coordination_unavailable')
    assert.equal(
      admission.status === 'coordination_unavailable' ? admission.message : '',
      STUDIO_RUN_COORDINATION_UNAVAILABLE_MESSAGE
    )
  })

  // ---------------------------------------------------------------------------------------
  // 15-21: service lifecycle and races
  // ---------------------------------------------------------------------------------------

  // 15.
  await run('scene admission: provisional ownership is registered before reconciliation', async () => {
    const deferred = createDeferred<StudioRun[]>()
    const runStore = createDeferredSceneListRunStore(OWNER_ID, deferred)
    const { service, scheduler } = memoryService({ runStore })

    const pending = service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    await waitFor(() => scheduler.scheduleCount === 1)
    await drainMicrotasks()

    assert.ok(
      service.getScopeLease(scopeA()),
      'the lease must already be locally registered while reconciliation is still pending'
    )
    assert.equal(service.getHeldScopeCount(), 1)

    deferred.resolve([])
    assert.equal((await pending).status, 'reserved')
  })

  // 16.
  await run('scene admission: scheduler setup failure rolls back only the matching scope', async () => {
    const coordinator = createInMemoryStudioRunCoordinator()
    const holder = memoryService({ coordinator })
    const failingScheduler = {
      schedule(): () => void {
        throw new Error('scheduler unavailable')
      }
    }
    const failing = new StudioRunCoordinationService({
      coordinator,
      scheduler: failingScheduler,
      logger: new RecordingStudioRunCoordinationLogger()
    })

    assert.equal((await holder.service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })).status, 'reserved')
    assert.equal((await failing.reserveScope({ ownerId: OWNER_ID, scope: scopeB() })).status, 'coordination_unavailable')
    assert.equal(holder.service.getScopeLease(scopeA()) !== null, true, 'the unrelated scope stays held')
    assert.equal(await coordinator.tryAcquire(scopeB()), null, 'the failed scope must still be held by the failing service')
    await failing.close()
    assert.ok(await coordinator.tryAcquire(scopeB()), 'closing released the scope that failed to schedule')
  })

  // 17.
  await run('scene admission: ownership proof and renewal tick share one serialized lane', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const renewStarted = createDeferred<void>()
    const releaseRenew = createDeferred<void>()
    let renewCalls = 0
    const originalRenew = coordinator.renew.bind(coordinator)
    coordinator.renew = async (lease) => {
      renewCalls += 1
      if (renewCalls === 1) {
        renewStarted.resolve()
        await releaseRenew.promise
      }
      return originalRenew(lease)
    }

    const { service, scheduler } = memoryService({ coordinator })
    const pendingAdmission = service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    await waitFor(() => scheduler.scheduleCount === 1)
    scheduler.runTick()
    await renewStarted.promise

    // The admission-time ownership proof must queue behind the in-flight tick.
    await drainMicrotasks()
    assert.equal(renewCalls, 1, 'the proof must not overtake the suspended renewal tick')

    releaseRenew.resolve()
    assert.equal((await pendingAdmission).status, 'reserved')
    assert.equal(renewCalls, 2, 'the proof runs after the tick, in the same lane')
  })

  // 18.
  await run('scene admission: a superseded rollback cannot remove a newer same-scope entry', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const deferred = createDeferred<StudioRun[]>()
    const { service } = memoryService({ coordinator, runStore: createDeferredSceneListRunStore(OWNER_ID, deferred) })

    const firstAdmission = service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    await drainMicrotasks()
    assert.equal(service.getScopeLease(scopeA())?.leaseId, 'lease-1')

    // A newer admission for the same scope replaces the local entry while the first is suspended.
    const secondAdmission = service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    await drainMicrotasks()
    assert.equal(service.getScopeLease(scopeA())?.leaseId, 'lease-2')

    deferred.resolve([])
    assert.equal((await firstAdmission).status, 'coordination_unavailable', 'the superseded admission must not be exposed')
    assert.equal((await secondAdmission).status, 'reserved')
    assert.equal(
      service.getScopeLease(scopeA())?.leaseId,
      'lease-2',
      'the stale rollback must not remove the newer entry'
    )
  })

  // 19.
  await run('scene admission: losing Scene A aborts A exactly once and leaves Scene B running', async () => {
    let clock = 1_000_000
    const coordinator = createInMemoryStudioRunCoordinator({ leaseTtlMs: 1_000, now: () => clock })
    const { service, scheduler } = memoryService({ coordinator, now: () => clock })
    await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    await service.reserveScope({ ownerId: OWNER_ID, scope: scopeB() })

    let abortsA = 0
    let abortsB = 0
    await service.attachRun({
      reservation: { scope: scopeA(), leaseId: service.getScopeLease(scopeA())!.leaseId },
      runId: 'run-a',
      abort: () => {
        abortsA += 1
      }
    })
    await service.attachRun({
      reservation: { scope: scopeB(), leaseId: service.getScopeLease(scopeB())!.leaseId },
      runId: 'run-b',
      abort: () => {
        abortsB += 1
      }
    })

    // A expires; B is renewed on the same tick, so both entries are exercised together.
    clock += 900
    scheduler.runTick()
    await service.whenIdle()
    clock += 200
    scheduler.runTick()
    await service.whenIdle()

    assert.equal(abortsA, 1, 'A loses ownership exactly once')
    assert.equal(abortsB, 0, 'B keeps its ownership')
    assert.equal(service.getActiveRunIds().includes('run-b'), true)
  })

  // 20.
  await run('scene admission: cancelling Scene A never aborts Scene B', async () => {
    const { service } = memoryService()
    await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    await service.reserveScope({ ownerId: OWNER_ID, scope: scopeB() })

    let abortsA = 0
    let abortsB = 0
    await service.attachRun({
      reservation: { scope: scopeA(), leaseId: service.getScopeLease(scopeA())!.leaseId },
      runId: 'run-a',
      abort: () => {
        abortsA += 1
      }
    })
    await service.attachRun({
      reservation: { scope: scopeB(), leaseId: service.getScopeLease(scopeB())!.leaseId },
      runId: 'run-b',
      abort: () => {
        abortsB += 1
      }
    })

    const outcome = await service.requestCancellation({ runId: 'run-a', reason: 'user stopped A' })
    assert.equal(outcome.status, 'signalled')
    assert.equal(abortsA, 1)
    assert.equal(abortsB, 0)
    assert.ok(service.getScopeLease(scopeB()), 'B keeps its lease')
  })

  // 21.
  await run('scene admission: close releases every local scope with compare-and-remove semantics', async () => {
    const coordinator = new FakeStudioRunCoordinator()
    const { service } = memoryService({ coordinator })
    const leaseA = await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    const leaseB = await service.reserveScope({ ownerId: OWNER_ID, scope: scopeB() })
    assert.equal(leaseA.status === 'reserved' && leaseB.status === 'reserved', true)

    const releasedScopes: string[] = []
    const originalRelease = coordinator.release.bind(coordinator)
    coordinator.release = async (lease) => {
      releasedScopes.push(canonicalStudioRunScopeKey(lease.scope))
      // B's token moved on (another replica took it): the compare-and-remove reports `false`,
      // and that must not stop close from clearing every local scope.
      if (lease.scope.kind === 'scene' && lease.scope.sceneId === 'scene-b') {
        return false
      }
      return originalRelease(lease)
    }

    await service.close()
    assert.equal(service.getHeldScopeCount(), 0)
    assert.deepEqual(releasedScopes.sort(), [canonicalStudioRunScopeKey(scopeA()), canonicalStudioRunScopeKey(scopeB())].sort())
  })

  // ---------------------------------------------------------------------------------------
  // 22-26: scoped versus Legacy reconciliation
  // ---------------------------------------------------------------------------------------

  // 22.
  await run('scene admission: Scene admission lists and reconciles only that Scene', async () => {
    const persistence = createInMemoryStudioPersistence()
    const store = new RecordingRunStore(persistence.runStore)
    const { service } = memoryService({ runStore: store })

    assert.equal((await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })).status, 'reserved')
    assert.deepEqual(store.listBySceneCalls, [{ ownerId: OWNER_ID, sceneId: 'scene-a' }])
    assert.equal(store.listBySessionCalls.length, 0, 'a Scene admission must never list the whole Session')
  })

  // 23.
  await run('scene admission: Scene A admission leaves an active Scene B Run untouched', async () => {
    const persistence = createInMemoryStudioPersistence()
    const store = new RecordingRunStore(persistence.runStore)
    const liveB = await store.create(
      createStudioRun({ ownerId: OWNER_ID, sessionId: 'session-1', sceneId: 'scene-b', inputText: 'b', activeAgent: 'builder' })
    )
    const staleA = await store.create(
      createStudioRun({ ownerId: OWNER_ID, sessionId: 'session-1', sceneId: 'scene-a', inputText: 'a', activeAgent: 'builder' })
    )
    const { service } = memoryService({ runStore: store })

    assert.equal((await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })).status, 'reserved')
    assert.deepEqual(store.transitions.map((transition) => transition.runId), [staleA.id])
    assert.equal((await store.getById(OWNER_ID, liveB.id))?.status, 'pending', 'the sibling Scene Run stays live')
  })

  // 24.
  await run('scene admission: Legacy admission reconciles every active Run of the Session', async () => {
    const persistence = createInMemoryStudioPersistence()
    const store = new RecordingRunStore(persistence.runStore)
    const eventBus = new RecordingEventBus()
    const sceneRun = await store.create(
      createStudioRun({ ownerId: OWNER_ID, sessionId: 'session-1', sceneId: 'scene-a', inputText: 'a', activeAgent: 'builder' })
    )
    const legacyRun = await store.create(
      createStudioRun({ ownerId: OWNER_ID, sessionId: 'session-1', inputText: 'l', activeAgent: 'builder' })
    )
    const { service } = memoryService({ runStore: store, eventBus })

    assert.equal((await service.reserveScope({ ownerId: OWNER_ID, scope: createLegacyStudioRunScope('session-1') })).status, 'reserved')
    assert.deepEqual(store.listBySessionCalls, [{ ownerId: OWNER_ID, sessionId: 'session-1' }])
    assert.equal(store.listBySceneCalls.length, 0)
    assert.deepEqual(
      store.transitions.map((transition) => transition.runId).sort(),
      [sceneRun.id, legacyRun.id].sort()
    )
    assert.equal(eventBus.events.filter((event) => event.type === 'run_updated').length, 2)
  })

  // 25.
  await run('scene admission: reconciliation never touches a terminal Run', async () => {
    const persistence = createInMemoryStudioPersistence()
    const store = new RecordingRunStore(persistence.runStore)
    await store.create(
      createStudioRun({ ownerId: OWNER_ID, sessionId: 'session-1', sceneId: 'scene-a', inputText: 'a', activeAgent: 'builder' })
    )
    const completed = await store.create(
      createStudioRun({ ownerId: OWNER_ID, sessionId: 'session-1', sceneId: 'scene-a', inputText: 'b', activeAgent: 'builder' })
    )
    await store.transitionStatus({ ownerId: OWNER_ID, runId: completed.id, from: ['pending', 'running'], patch: { status: 'completed' } })
    const { service } = memoryService({ runStore: store })
    store.transitions.length = 0

    assert.equal((await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })).status, 'reserved')
    const touched = store.transitions.map((transition) => transition.runId)
    assert.equal(touched.includes(completed.id), false, 'a terminal Run must not be re-transitioned')
    assert.equal(touched.length, 1)
  })

  // 26.
  await run('scene admission: an unidentifiable listed Run rejects admission and releases the lease', async () => {
    const persistence = createInMemoryStudioPersistence()
    const store = new RecordingRunStore(persistence.runStore, {
      transitionOverride: async () => ({ applied: false, run: null })
    })
    const coordinator = createInMemoryStudioRunCoordinator()
    await store.create(
      createStudioRun({ ownerId: OWNER_ID, sessionId: 'session-1', sceneId: 'scene-a', inputText: 'stale', activeAgent: 'builder' })
    )
    const { service } = memoryService({ coordinator, runStore: store })

    const admission = await service.reserveScope({ ownerId: OWNER_ID, scope: scopeA() })
    assert.equal(admission.status, 'coordination_unavailable')
    assert.equal(service.getHeldScopeCount(), 0, 'no local scope may remain')
    assert.ok(await coordinator.tryAcquire(scopeA()), 'the lease must have been released')
  })

  // ---------------------------------------------------------------------------------------
  // 27-30, 32: runtime propagation through the Run service
  // ---------------------------------------------------------------------------------------

  // 27.
  await run('scene admission: an unknown or foreign Scene produces not_found before any reservation', async () => {
    const { service, persistence, stub, coordination } = createRunServiceHarness({ coordinator: new FakeStudioRunCoordinator() })
    const session = createSession()

    const unknown = await service.startRun({
      ownerId: OWNER_ID,
      projectId: session.projectId,
      session,
      sceneId: 'scene_missing',
      inputText: 'hi'
    })
    assert.equal(unknown.status, 'not_found')

    const otherSession = createSession({ title: 'other' })
    const foreign = await persistence.sceneStore.create(
      createStudioScene({
        ownerId: OWNER_ID,
        sessionId: otherSession.id,
        position: 0,
        sourcePath: 'scenes/foreign.py'
      })
    )
    const foreignResult = await service.startRun({
      ownerId: OWNER_ID,
      projectId: session.projectId,
      session,
      sceneId: foreign.id,
      inputText: 'hi'
    })
    assert.equal(foreignResult.status, 'not_found', 'a Scene of another Session is collapsed into not_found')

    assert.equal(coordination.coordinator.acquiredScopes.length, 0, 'nothing may be reserved')
    assert.equal(stub.inputs.length, 0, 'no Run may be started')
    assert.deepEqual(await persistence.runStore.listBySessionId(OWNER_ID, session.id), [])
  })

  // 28.
  await run('scene admission: a scoped start persists Run and both messages with one identical sceneId', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createSession()
    const scene = await seedScene(persistence, session, 0)
    const runtime = new StudioBuilderRuntime({
      registry: new StudioToolRegistry(),
      messageStore: persistence.messageStore,
      partStore: persistence.partStore,
      runStore: persistence.runStore,
      renderStore: persistence.renderStore,
      eventBus: new InMemoryStudioEventBus()
    })
    const modelPort: StudioModelPort = {
      complete: async () =>
        ({
          id: 'cmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'fake',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }]
        }) as never
    }

    const handle = await runtime.startBackgroundRun({
      projectId: session.projectId,
      session,
      sceneId: scene.id,
      inputText: 'scoped start',
      modelPort
    })
    handle.abort('spec cleanup')

    const runs = await persistence.runStore.listBySceneId(OWNER_ID, scene.id)
    assert.equal(runs.length, 1)
    assert.equal(runs[0]?.sceneId, scene.id)
    const messages = await persistence.messageStore.listBySceneId(scene.id)
    assert.equal(messages.length, 2, 'the user message and the assistant message are both scoped')
    assert.deepEqual(messages.map((message) => message.sceneId), [scene.id, scene.id])
    assert.deepEqual(
      messages.map((message) => message.role).sort(),
      ['assistant', 'user'],
      'both initial records carry the identical sceneId before execution proceeds'
    )
  })

  // 29.
  await run('scene admission: a Legacy start leaves sceneId absent on Run and both messages', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createSession()
    const runtime = new StudioBuilderRuntime({
      registry: new StudioToolRegistry(),
      messageStore: persistence.messageStore,
      partStore: persistence.partStore,
      runStore: persistence.runStore,
      renderStore: persistence.renderStore,
      eventBus: new InMemoryStudioEventBus()
    })
    const modelPort: StudioModelPort = {
      complete: async () =>
        ({
          id: 'cmpl-2',
          object: 'chat.completion',
          created: 0,
          model: 'fake',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }]
        }) as never
    }

    const handle = await runtime.startBackgroundRun({
      projectId: session.projectId,
      session,
      inputText: 'legacy start',
      modelPort
    })
    handle.abort('spec cleanup')

    const runs = await persistence.runStore.listBySessionId(OWNER_ID, session.id)
    assert.equal(runs.length, 1)
    assert.equal('sceneId' in (runs[0] as object), false, 'a Legacy Run must not carry the key at all')
    const messages = await persistence.messageStore.listBySessionId(session.id)
    assert.equal(messages.length, 2)
    for (const message of messages) {
      assert.equal('sceneId' in (message as object), false)
    }
  })

  // 30.
  await run('scene admission: a scoped continuation inherits its Scene and a Legacy one stays Legacy', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createSession()
    await persistence.sessionStore.create(session)
    const scene = await seedScene(persistence, session, 0)
    const resumableMetadata = { autonomy: { stopReason: 'step budget exhausted' } }
    const scopedSource = await persistence.runStore.create({
      ...createStudioRun({
        ownerId: OWNER_ID,
        sessionId: session.id,
        sceneId: scene.id,
        inputText: 'first',
        activeAgent: 'builder'
      }),
      status: 'completed',
      metadata: resumableMetadata
    })
    const legacySource = await persistence.runStore.create({
      ...createStudioRun({ ownerId: OWNER_ID, sessionId: session.id, inputText: 'legacy', activeAgent: 'builder' }),
      status: 'completed',
      metadata: resumableMetadata
    })

    // The stub coordinator grants both admissions: this spec proves inheritance, not exclusion, and
    // the first continuation's scope stays held until its (pending) completion finishes.
    const coordinator = new FakeStudioRunCoordinator()
    const stub = createStubRunRuntime()
    const coordination = memoryService({ coordinator, runStore: persistence.runStore, eventBus: new RecordingEventBus() })
    const service = createStudioRunService({
      persistence,
      runtime: stub.runtime,
      eventBus: new RecordingEventBus(),
      coordination: coordination.service
    })

    const scoped = await service.continueRun({ ownerId: OWNER_ID, projectId: session.projectId, sourceRunId: scopedSource.id })
    assert.equal(scoped.status, 'started')
    const legacy = await service.continueRun({ ownerId: OWNER_ID, projectId: session.projectId, sourceRunId: legacySource.id })
    assert.equal(legacy.status, 'started')

    assert.deepEqual(
      stub.inputs.map((entry) => entry.sceneId),
      [scene.id, undefined],
      'the Scene is inherited exactly, and a Legacy continuation stays Legacy'
    )
    assert.deepEqual(
      coordination.coordinator.acquiredScopes.map((scope) => scope.kind),
      ['scene', 'legacy-session'],
      'a Scene continuation reserves its Scene, a Legacy continuation reserves the Session'
    )
  })

  // 32.
  await run('scene admission: sibling Scene starts are admitted and a second same-Scene start conflicts', async () => {
    const persistence = createInMemoryStudioPersistence()
    const session = createSession()
    const sceneA = await seedScene(persistence, session, 0)
    const sceneB = await seedScene(persistence, session, 1)
    const stub = createStubRunRuntime()
    const coordination = memoryService({ runStore: persistence.runStore, eventBus: new RecordingEventBus() })
    const service = createStudioRunService({
      persistence,
      runtime: stub.runtime,
      eventBus: new RecordingEventBus(),
      coordination: coordination.service
    })

    const first = await service.startRun({
      ownerId: OWNER_ID,
      projectId: session.projectId,
      session,
      sceneId: sceneA.id,
      inputText: 'a'
    })
    const sibling = await service.startRun({
      ownerId: OWNER_ID,
      projectId: session.projectId,
      session,
      sceneId: sceneB.id,
      inputText: 'b'
    })
    const conflicting = await service.startRun({
      ownerId: OWNER_ID,
      projectId: session.projectId,
      session,
      sceneId: sceneA.id,
      inputText: 'a again'
    })

    assert.equal(first.status, 'started')
    assert.equal(sibling.status, 'started')
    assert.equal(conflicting.status, 'conflict')
    assert.deepEqual(
      stub.inputs.map((entry) => entry.sceneId),
      [sceneA.id, sceneB.id],
      'both siblings started, and the refused third attempt never reached the runtime'
    )
  })

  // ---------------------------------------------------------------------------------------
  // 31: render scope propagation (Task 11B2A addendum unlock)
  // ---------------------------------------------------------------------------------------

  // 31.
  await run('scene admission: a scoped Manim render copies run.sceneId', async () => {
    const context = createToolContext('manim', 'scene-a')
    const tool = createStudioRenderTool({ async submit() { return { jobId: 'job-1' } } })

    await tool.execute({ concept: 'circle', code: 'class Scene: pass' }, context)

    const renders = await context.renderStore!.listBySceneId(context.session.ownerId, 'scene-a')
    assert.equal(renders.length, 1)
    assert.equal(renders[0]?.sceneId, 'scene-a')
    assert.equal(renders[0]?.runId, context.run.id)
  })

  // 31.
  await run('scene admission: a Legacy Manim render leaves sceneId absent', async () => {
    const context = createToolContext('manim')
    const tool = createStudioRenderTool({ async submit() { return { jobId: 'job-2' } } })

    await tool.execute({ concept: 'circle', code: 'class Scene: pass' }, context)

    const renders = await context.renderStore!.listBySessionId(context.session.ownerId, context.session.id)
    assert.equal(renders.length, 1)
    assert.equal('sceneId' in (renders[0] as object), false)
  })

  // 31.
  await run('scene admission: render ports receive unchanged payloads (scope stays persistence-only)', async () => {
    const manimRequests: Array<Record<string, unknown>> = []
    const manimTool = createStudioRenderTool({
      async submit(input) {
        manimRequests.push({ ...input })
        return { jobId: input.jobId }
      }
    })
    const manimContext = createToolContext('manim', 'scene-a')
    await manimTool.execute({ concept: 'circle', code: 'class Scene: pass', outputMode: 'image', quality: 'high' }, manimContext)
    assert.deepEqual(Object.keys(manimRequests[0] ?? {}).sort(), [
      'code',
      'concept',
      'jobId',
      'outputMode',
      'quality',
      'workspaceDirectory'
    ])
    assert.equal('sceneId' in (manimRequests[0] ?? {}), false, 'the render port payload is untouched')

    const plotRequests: Array<Record<string, unknown>> = []
    const plotTool = createPlotStudioRenderTool({
      async execute(input) {
        plotRequests.push({ ...input })
        return {
          outputDir: '/workspace/plot/renders/spec',
          scriptPath: '/workspace/plot/renders/spec/plot_script.py',
          imageDataUris: ['data:image/png;base64,spec'],
          imagePaths: ['/workspace/plot/renders/spec/plot_1.png'],
          stdout: 'ok',
          stderr: ''
        }
      }
    })
    const plotContext = createToolContext('plot', 'scene-b')
    await plotTool.execute({ concept: 'line', code: 'import matplotlib' }, plotContext)
    assert.deepEqual(Object.keys(plotRequests[0] ?? {}).sort(), ['code', 'concept'])
    assert.equal('sceneId' in (plotRequests[0] ?? {}), false, 'the plot port payload is untouched')
  })

  // 31.
  await run('scene admission: render failure and update paths keep the persisted scope', async () => {
    const manimContext = createToolContext('manim', 'scene-a')
    const failingManim = createStudioRenderTool({
      async submit() {
        throw new Error('queue unavailable')
      }
    })
    await assert.rejects(() => failingManim.execute({ concept: 'circle', code: 'class Scene: pass' }, manimContext), /queue unavailable/)
    const failedRenders = await manimContext.renderStore!.listBySceneId(manimContext.session.ownerId, 'scene-a')
    assert.equal(failedRenders[0]?.status, 'failed')
    assert.equal(failedRenders[0]?.sceneId, 'scene-a', 'the failed update keeps the immutable scope')

    const plotContext = createToolContext('plot', 'scene-b')
    const completingPlot = createPlotStudioRenderTool({
      async execute() {
        return {
          outputDir: '/workspace/plot/renders/spec',
          scriptPath: '/workspace/plot/renders/spec/plot_script.py',
          imageDataUris: ['data:image/png;base64,spec'],
          imagePaths: ['/workspace/plot/renders/spec/plot_1.png'],
          stdout: 'ok',
          stderr: ''
        }
      }
    })
    await completingPlot.execute({ concept: 'line', code: 'import matplotlib' }, plotContext)
    const completed = await plotContext.renderStore!.listBySceneId(plotContext.session.ownerId, 'scene-b')
    assert.equal(completed[0]?.status, 'completed')
    assert.equal(completed[0]?.sceneId, 'scene-b', 'the completed update keeps the immutable scope')

    const failingPlot = createPlotStudioRenderTool({
      async execute() {
        throw new Error('plot execution failed')
      }
    })
    const failingPlotContext = createToolContext('plot', 'scene-c')
    await assert.rejects(
      () => failingPlot.execute({ concept: 'line', code: 'import matplotlib' }, failingPlotContext),
      /plot execution failed/
    )
    const failedPlotRenders = await failingPlotContext.renderStore!.listBySceneId(failingPlotContext.session.ownerId, 'scene-c')
    assert.equal(failedPlotRenders[0]?.status, 'failed')
    assert.equal(failedPlotRenders[0]?.sceneId, 'scene-c')
  })

  // ---------------------------------------------------------------------------------------
  // Scope helper invariants that the whole matrix rests on
  // ---------------------------------------------------------------------------------------

  await run('scene admission: canonical scope keys, admission fields and tokens are scope-complete', async () => {
    assert.equal(canonicalStudioRunScopeKey(createLegacyStudioRunScope('session-1')), 'legacy:session-1')
    assert.equal(canonicalStudioRunScopeKey(scopeA()), 'scene:session-1:scene-a')
    assert.equal(studioRunScopeAdmissionField(createLegacyStudioRunScope('session-1')), 'legacy')
    assert.equal(studioRunScopeAdmissionField(scopeA()), 'scene:scene-a')
    assert.notEqual(studioRunScopeAdmissionField(scopeA()), studioRunScopeAdmissionField(scopeB()))

    const token = serializeStudioRunLeaseToken({
      scope: scopeA(),
      leaseId: 'lease-1',
      ownerInstanceId: 'owner-a'
    } as never)
    const sibling = serializeStudioRunLeaseToken({
      scope: scopeB(),
      leaseId: 'lease-1',
      ownerInstanceId: 'owner-a'
    } as never)
    assert.notEqual(token, sibling, 'the token covers the whole scope, never a subset')

    // Transport defaults stay the Task 11A values, so 11B2A changes no deployment knob.
    assert.equal(resolveStudioRunCoordinationTransport({ NODE_ENV: 'test' }), 'memory')
    assert.equal(resolveStudioRunCoordinationTransport({}), 'redis')
    assert.equal(resolveStudioRunLeaseTtlMs({}), 60_000)
    assert.equal(resolveStudioRunLeaseRenewMs({}), 15_000)
    assert.ok(resolveStudioRunLeaseRenewMs({}) * 2 < resolveStudioRunLeaseTtlMs({}))
    assert.throws(() => resolveStudioRunCoordinationTransport({ STUDIO_RUN_COORDINATION: 'nope' }))

    // A Scene scope whose identifier cannot be encoded is rejected instead of keyed.
    assert.throws(() => canonicalStudioRunScopeKey(createSceneStudioRunScope('session-1', '   ')))
    assert.throws(() => createSceneStudioRunScope('session-1', 'x'.repeat(201)))
  })
}
