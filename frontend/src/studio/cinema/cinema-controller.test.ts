import { describe, expect, it, vi } from 'vitest'
import type {
  StudioCreateSceneRunInput,
  StudioCreateSceneRunResponse,
  StudioScene,
  StudioSceneMessage,
  StudioSceneSnapshot,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'
import type {
  StudioEventConnectionStatus,
  StudioEventSubscriptionOptions,
} from '../api/studio-agent-events'
import { StudioApiRequestError } from '../api/client'
import {
  readStudioCinemaSnapshotOwnershipVerdict,
  type StudioCinemaSnapshotOwnership,
  type StudioCinemaSnapshotOwnershipFacts,
} from './recovery-ownership'
import {
  StudioCinemaController,
  createStudioCinemaController,
  type StudioCinemaCancelResponse,
  type StudioCinemaControllerDependencies,
} from './cinema-controller'
import { selectSceneState } from './scene-state'
import {
  readStudioCinemaActiveRun,
  readStudioCinemaSceneEligibility,
  selectStudioCinemaSceneView,
} from './scene-selectors'
import {
  STUDIO_CINEMA_RECOVERY_BUFFER_LIMIT,
  STUDIO_CINEMA_RENDER_REFRESH_BACKOFF_MAX_MS,
  STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS,
  STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT,
  STUDIO_CINEMA_RENDER_REFRESH_MAX_CONSECUTIVE_FAILURES,
  type StudioCinemaSceneIdentity,
} from './types'
import {
  CINEMA_TEST_ISO,
  CINEMA_TEST_SCENE_A,
  CINEMA_TEST_SCENE_B,
  CINEMA_TEST_SESSION_ID,
  createTestFrame,
  createTestRender,
  createTestRun,
  createTestRunFrame,
  createTestScene,
  createTestSceneSnapshot,
  createTestScopedProperties,
  createTestTextFrame,
} from './cinema-fixtures'

/**
 * Cinema controller specs (task 11C1, sections 4 to 6, and the R2 to R5 corrections).
 *
 * Every dependency is a named fake: a programmable API, a capturing event source, a fixed clock and
 * an abort factory. There is no socket, no server, no real timer and no sleep — the async ordering
 * that matters (sequential creation, connection-gated recovery, late responses after a switch) is
 * driven by deferreds the spec resolves by hand.
 */

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

interface FakeScheduledTask {
  delayMs: number
  run: () => void
}

/**
 * Hand driven scheduler: the refresh loop is exercised without a timer and without a sleep. A spec
 * fires one scheduled tick at a time, exactly as the real clock would.
 */
interface FakeScheduler {
  pending: FakeScheduledTask[]
  schedule: (delayMs: number, task: () => void) => () => void
  fire: () => Promise<void>
  pendingCount: () => number
}

function createFakeScheduler(): FakeScheduler {
  const pending: FakeScheduledTask[] = []
  return {
    pending,
    schedule: (delayMs, task) => {
      const entry: FakeScheduledTask = { delayMs, run: task }
      pending.push(entry)
      return () => {
        const index = pending.indexOf(entry)
        if (index >= 0) {
          pending.splice(index, 1)
        }
      }
    },
    async fire() {
      const entry = pending.shift()
      if (!entry) {
        throw new Error('no scheduled refresh tick')
      }
      entry.run()
      await flush()
    },
    pendingCount: () => pending.length,
  }
}

/** Drains the pending microtask queue; no timer and no sleep are involved. */
async function flush(): Promise<void> {
  for (let index = 0; index < 32; index += 1) {
    await Promise.resolve()
  }
}

interface FakeSubscription {
  options: StudioEventSubscriptionOptions
  emit: (frame: unknown) => void
  emitStatus: (status: StudioEventConnectionStatus) => void
  isAborted: () => boolean
}

interface Harness {
  controller: StudioCinemaController
  scheduler: FakeScheduler
  calls: {
    createScene: string[]
    getSessionSnapshot: string[]
    getSceneSnapshot: string[]
    createSceneRun: Array<{ sessionId: string; sceneId: string; input: StudioCreateSceneRunInput }>
    cancelRun: string[]
  }
  subscriptions: FakeSubscription[]
  /** Fake server-side Scene list of a Session, so a recovery read can return existing Scenes. */
  server: {
    setScenes: (sessionId: string, sceneIds: string[]) => void
  }
}

/** A harness whose Scene snapshot carries one live Run, so a cancel has a real target. */
function createCancelHarness(options: {
  cancelRun: (runId: string) => Promise<StudioCinemaCancelResponse>
}): Harness {
  return createHarness({
    ...options,
    getSceneSnapshot: async (sessionId, sceneId) =>
      createTestSceneSnapshot(sessionId, sceneId, { runs: [createTestRun(sceneId, 'run_1', 'running')] }),
  })
}

/** Seeds the Scene and connects it. */
async function seedRunningScene(harness: Harness): Promise<void> {
  await seedScenes(harness, [CINEMA_TEST_SCENE_A])
  await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
  // Await an authoritative checkpoint rather than guessing how many microtasks recovery needs.
  expect(await harness.controller.reconcileScene(CINEMA_TEST_SCENE_A)).toBe('ok')
  expect(readStudioCinemaActiveRun(sceneRecord(harness, CINEMA_TEST_SCENE_A))?.id).toBe('run_1')
}

function createHarness(options?: {
  createScene?: (sessionId: string, callIndex: number) => Promise<StudioScene>
  getSceneSnapshot?: (sessionId: string, sceneId: string) => Promise<StudioSceneSnapshot>
  getSessionSnapshot?: (sessionId: string) => Promise<StudioSessionSnapshot>
  createSceneRun?: (
    sessionId: string,
    sceneId: string,
    input: StudioCreateSceneRunInput,
  ) => Promise<StudioCreateSceneRunResponse>
  cancelRun?: (runId: string) => Promise<StudioCinemaCancelResponse>
  subscribe?: (options: StudioEventSubscriptionOptions) => Promise<void>
  providerIncomplete?: boolean
  providerThrows?: boolean
  workflowIdThrowsOnce?: boolean
}): Harness {
  const scheduler = createFakeScheduler()
  const calls: Harness['calls'] = {
    createScene: [],
    getSessionSnapshot: [],
    getSceneSnapshot: [],
    createSceneRun: [],
    cancelRun: [],
  }
  const subscriptions: FakeSubscription[] = []
  const serverScenes = new Map<string, StudioScene[]>()

  let workflowIdCalls = 0

  const dependencies: StudioCinemaControllerDependencies = {
    api: {
      createScene: (sessionId) => {
        const callIndex = calls.createScene.length
        calls.createScene.push(sessionId)
        if (options?.createScene) {
          return options.createScene(sessionId, callIndex)
        }
        const scene = createTestScene(sessionId, `scene_00${String(callIndex + 1).padStart(2, '0')}`, callIndex)
        serverScenes.set(sessionId, [...(serverScenes.get(sessionId) ?? []), scene])
        return Promise.resolve(scene)
      },
      reorderScenes: async (_sessionId, sceneIds) =>
        sceneIds.map((sceneId, index) => createTestScene(CINEMA_TEST_SESSION_ID, sceneId, index)),
      getSceneSnapshot: (sessionId, sceneId) => {
        calls.getSceneSnapshot.push(sceneId)
        return options?.getSceneSnapshot
          ? options.getSceneSnapshot(sessionId, sceneId)
          : Promise.resolve(createTestSceneSnapshot(sessionId, sceneId))
      },
      getSessionSnapshot: (sessionId) => {
        calls.getSessionSnapshot.push(sessionId)
        if (options?.getSessionSnapshot) {
          return options.getSessionSnapshot(sessionId)
        }
        return Promise.resolve({
          session: sessionFixture(sessionId),
          messages: [],
          runs: [],
          renders: [],
          scenes: [...(serverScenes.get(sessionId) ?? [])],
        })
      },
      createSceneRun: (sessionId, sceneId, input) => {
        calls.createSceneRun.push({ sessionId, sceneId, input })
        return options?.createSceneRun
          ? options.createSceneRun(sessionId, sceneId, input)
          : Promise.resolve(
              createAcceptedResponse(sessionId, sceneId, `run_${calls.createSceneRun.length + 1}`),
            )
      },
      cancelRun: (runId) => {
        calls.cancelRun.push(runId)
        return options?.cancelRun ? options.cancelRun(runId) : Promise.resolve({ status: 'cancelled' })
      },
    },
    provider: {
      resolve: () => {
        if (options?.providerThrows) {
          throw new Error('provider resolution failed')
        }
        return options?.providerIncomplete
          ? { hasIncompleteProvider: true }
          : { customApiConfig: { apiUrl: 'http://provider.invalid', apiKey: 'k', model: 'm' }, hasIncompleteProvider: false }
      },
    },
    events: {
      subscribe: (subscriptionOptions) => {
        subscriptions.push({
          options: subscriptionOptions,
          emit: (frame) => subscriptionOptions.onEvent(frame as never),
          emitStatus: (status) => subscriptionOptions.onStatusChange?.(status),
          isAborted: () => subscriptionOptions.signal.aborted,
        })
        return options?.subscribe ? options.subscribe(subscriptionOptions) : Promise.resolve()
      },
    },
    clock: { now: () => 1_700_000_000_000 },
    createAbortController: () => new AbortController(),
    createWorkflowId: () => {
      workflowIdCalls += 1
      if (options?.workflowIdThrowsOnce && workflowIdCalls === 1) {
        throw new Error('workflow id unavailable')
      }
      return 'workflow_1'
    },
    scheduler: { schedule: scheduler.schedule },
  }

  return {
    controller: new StudioCinemaController(dependencies),
    scheduler,
    calls,
    subscriptions,
    server: {
      setScenes: (sessionId, sceneIds) => {
        serverScenes.set(
          sessionId,
          sceneIds.map((sceneId, index) => createTestScene(sessionId, sceneId, index)),
        )
      },
    },
  }
}

function sessionFixture(sessionId: string) {
  return {
    id: sessionId,
    projectId: 'project_1',
    agentType: 'builder' as const,
    title: 'Cinema',
    directory: 'scenes/workspace',
    createdAt: '2026-03-22T00:00:00.000Z',
    updatedAt: '2026-03-22T00:00:00.000Z',
  }
}

function createAcceptedResponse(
  sessionId: string,
  sceneId: string,
  runId: string,
): StudioCreateSceneRunResponse {
  const run = createTestRun(sceneId, runId, 'running', sessionId)
  return {
    scene: createTestScene(sessionId, sceneId, 0),
    messages: [],
    runs: [run],
    renders: [],
    run,
  }
}

function sceneRecord(harness: Harness, sceneId: string) {
  const identity: StudioCinemaSceneIdentity = { sessionId: CINEMA_TEST_SESSION_ID, sceneId }
  const record = selectSceneState(harness.controller.getState(), identity)
  if (!record) {
    throw new Error(`missing scene record for ${sceneId}`)
  }
  return record
}

function lastSubscription(harness: Harness): FakeSubscription {
  const subscription = harness.subscriptions[harness.subscriptions.length - 1]
  if (!subscription) {
    throw new Error('missing subscription')
  }
  return subscription
}

/** Seeds a Session whose Scenes already exist server-side, then reads the index like production. */
async function seedScenes(harness: Harness, sceneIds: string[]): Promise<void> {
  harness.server.setScenes(CINEMA_TEST_SESSION_ID, sceneIds)
  harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID, projectId: 'project_1' })
  await harness.controller.loadSceneIndex()
}

/** Selects a Scene and drives it to a real connection, which is what starts its recovery read. */
async function selectSceneAndConnect(harness: Harness, sceneId: string): Promise<FakeSubscription> {
  harness.controller.selectScene(sceneId)
  const subscription = lastSubscription(harness)
  subscription.emitStatus({ state: 'connected', attempt: 1 })
  await flush()
  return subscription
}

/** One assistant message with a single text part, as the authoritative snapshot carries it. */
function assistantMessage(
  sessionId: string,
  sceneId: string,
  text: string,
  id = 'message_1',
): StudioSceneMessage {
  return {
    id,
    sessionId,
    sceneId,
    role: 'assistant',
    agent: 'builder',
    parts: [{ id: `${id}_text`, messageId: id, sessionId, type: 'text', text }],
    createdAt: CINEMA_TEST_ISO,
    updatedAt: CINEMA_TEST_ISO,
  }
}

/** The assistant text of one Scene, which is what a user reads on the big screen. */
function readAssistantText(harness: Harness, sceneId: string): string {
  const message = sceneRecord(harness, sceneId).messages.find((entry) => entry.role === 'assistant')
  const part = message?.role === 'assistant' ? message.parts[0] : null
  return part?.type === 'text' ? part.text : ''
}

/** Counts the requests that are really in flight, so a spec can assert the lane's concurrency. */
function createInFlightCounter() {
  let inFlight = 0
  let maxInFlight = 0
  return {
    max: () => maxInFlight,
    track: <T,>(promise: Promise<T>): Promise<T> => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return promise.finally(() => {
        inFlight -= 1
      })
    },
  }
}

describe('studio cinema controller', () => {
  it('creates the three default scenes sequentially and selects the first one', async () => {
    const deferreds = [createDeferred<StudioScene>(), createDeferred<StudioScene>(), createDeferred<StudioScene>()]
    const order: string[] = []
    const harness = createHarness({
      createScene: (_sessionId, callIndex) => {
        order.push(`create-${callIndex}`)
        return deferreds[callIndex]?.promise ?? Promise.reject(new Error('unexpected call'))
      },
    })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID, projectId: 'project_1' })
    const workflow = harness.controller.initializeScenes()
    await flush()
    expect(order).toEqual(['create-0'])

    deferreds[0]?.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_first', 0))
    await flush()
    expect(order).toEqual(['create-0', 'create-1'])

    deferreds[1]?.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_second', 1))
    await flush()
    expect(order).toEqual(['create-0', 'create-1', 'create-2'])

    deferreds[2]?.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_third', 2))
    await expect(workflow).resolves.toEqual({ status: 'ready', createdCount: 3 })

    const state = harness.controller.getState()
    expect(state.sceneOrder).toEqual(['scene_first', 'scene_second', 'scene_third'])
    expect(state.selectedSceneId).toBe('scene_first')
    expect(state.initialization.status).toBe('ready')
    expect(harness.subscriptions).toHaveLength(1)
    // Nothing is read from the server before the stream reports a real connection.
    expect(harness.calls.getSceneSnapshot).toHaveLength(0)
  })

  it('joins a running workflow on a StrictMode replay instead of creating six scenes', async () => {
    const firstCreate = createDeferred<StudioScene>()
    const harness = createHarness({
      createScene: (_sessionId, callIndex) =>
        callIndex === 0
          ? firstCreate.promise
          : Promise.resolve(createTestScene(CINEMA_TEST_SESSION_ID, `scene_00${callIndex + 1}`, callIndex)),
    })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })
    const first = harness.controller.initializeScenes()
    const replay = harness.controller.initializeScenes()
    await flush()
    expect(harness.calls.createScene).toHaveLength(1)

    firstCreate.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_001', 0))
    await expect(first).resolves.toEqual({ status: 'ready', createdCount: 3 })
    await expect(replay).resolves.toEqual({ status: 'ready', createdCount: 3 })
    expect(harness.calls.createScene).toHaveLength(3)

    // Once the workflow is ready, a further call is a no-op rather than three more Scenes.
    await expect(harness.controller.initializeScenes()).resolves.toEqual({
      status: 'already_ready',
      createdCount: 3,
    })
    expect(harness.calls.createScene).toHaveLength(3)
  })

  // Correction 11C6-P1: the workflow promise is published before the work starts, so a failure that
  // happens before the work can even begin still settles that promise instead of throwing out of the
  // public call - and the slot is free again for the next attempt.
  it('settles the published workflow promise when the work cannot start at all', async () => {
    const harness = createHarness({ workflowIdThrowsOnce: true })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID, projectId: 'project_1' })
    const workflow = harness.controller.initializeScenes()

    await expect(workflow).rejects.toThrow('workflow id unavailable')
    expect(harness.calls.createScene).toHaveLength(0)
    await expect(harness.controller.initializeScenes()).resolves.toEqual({ status: 'ready', createdCount: 3 })
    expect(harness.calls.createScene).toHaveLength(3)
  })

// 11C7 Review Correction: the cancel response is a three-way decision, never a silent success.
  // A = the official compatibility shape (no `run` property), B = a legal Run that matches the
  // requested target, C = present but malformed / cross-identity / unsupported status.
  it('refuses a cancel response whose Run is another Run of the same Scene', async () => {
    const harness = createCancelHarness({ cancelRun: async () => ({ status: 'cancelled', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_other', 'cancelled') }) })
    await seedRunningScene(harness)

    const outcome = await harness.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)

    expect(outcome).toEqual({ status: 'failed', code: 'run_cancel_failed' })
    expect(record.cancelRequested).toBe(false)
    expect(record.runs.some((run) => run.id === 'run_other')).toBe(false)
    expect(record.runs.find((run) => run.id === 'run_1')?.status).toBe('running')
    expect(record.feedback).toEqual({ code: 'run_cancel_failed', needsReconciliation: true })
    expect(record.needsReconciliation).toBe(true)
  })

  it('refuses a cancel response whose Run belongs to a sibling Scene or another Session', async () => {
    const sibling = createCancelHarness({ cancelRun: async () => ({ status: 'cancelled', run: createTestRun(CINEMA_TEST_SCENE_B, 'run_1', 'cancelled') }) })
    await seedRunningScene(sibling)
    expect(await sibling.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).toEqual({ status: 'failed', code: 'run_cancel_failed' })
    expect(sceneRecord(sibling, CINEMA_TEST_SCENE_A).runs.find((run) => run.id === 'run_1')?.status).toBe('running')

    const otherSessionSameSceneId = createCancelHarness({
      cancelRun: async () => ({ status: 'cancelled', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'cancelled', 'session_other') }),
    })
    await seedRunningScene(otherSessionSameSceneId)
    expect(await otherSessionSameSceneId.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).toEqual({
      status: 'failed',
      code: 'run_cancel_failed',
    })
    expect(sceneRecord(otherSessionSameSceneId, CINEMA_TEST_SCENE_A).runs.find((run) => run.id === 'run_1')?.status).toBe('running')
  })

  it('never fabricates a local terminal status from a malformed or unsupported cancel payload', async () => {
    const malformed = createCancelHarness({ cancelRun: async () => ({ status: 'cancelled', run: { id: 'run_1' } }) })
    await seedRunningScene(malformed)
    expect(await malformed.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).toEqual({ status: 'failed', code: 'run_cancel_failed' })
    expect(sceneRecord(malformed, CINEMA_TEST_SCENE_A).runs.find((run) => run.id === 'run_1')?.status).toBe('running')
    expect(sceneRecord(malformed, CINEMA_TEST_SCENE_A).cancelRequested).toBe(false)

    const presentButNull = createCancelHarness({ cancelRun: async () => ({ status: 'cancelled', run: null }) })
    await seedRunningScene(presentButNull)
    expect(await presentButNull.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).toEqual({ status: 'failed', code: 'run_cancel_failed' })
    expect(sceneRecord(presentButNull, CINEMA_TEST_SCENE_A).runs.find((run) => run.id === 'run_1')?.status).toBe('running')

    const unsupportedStatus = createCancelHarness({ cancelRun: async () => ({ status: 'weird' as never }) })
    await seedRunningScene(unsupportedStatus)
    expect(await unsupportedStatus.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).toEqual({ status: 'failed', code: 'run_cancel_failed' })
    expect(sceneRecord(unsupportedStatus, CINEMA_TEST_SCENE_A).runs.find((run) => run.id === 'run_1')?.status).toBe('running')
  })

  it('keeps the legal status-only response and a matching complete Run working', async () => {
    const statusOnly = createCancelHarness({ cancelRun: async () => ({ status: 'cancelled' }) })
    await seedRunningScene(statusOnly)
    expect(await statusOnly.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).toEqual({ status: 'requested' })
    const statusOnlyRecord = sceneRecord(statusOnly, CINEMA_TEST_SCENE_A)
    expect(statusOnlyRecord.runs.find((run) => run.id === 'run_1')?.status).toBe('cancelled')
    expect(statusOnlyRecord.cancelRequested).toBe(false)

    const complete = createCancelHarness({
      cancelRun: async () => ({ status: 'cancelled', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'cancelled') }),
    })
    await seedRunningScene(complete)
    expect(await complete.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).toEqual({ status: 'requested' })
    const completeRecord = sceneRecord(complete, CINEMA_TEST_SCENE_A)
    expect(completeRecord.runs.filter((run) => run.id === 'run_1')).toHaveLength(1)
    expect(completeRecord.runs.find((run) => run.id === 'run_1')?.status).toBe('cancelled')
    expect(completeRecord.feedback).toBeNull()
  })

  it('reports stale for a cancel whose generation moved on and leaves the new Session untouched', async () => {
    const hung = createDeferred<StudioCinemaCancelResponse>()
    const harness = createCancelHarness({ cancelRun: () => hung.promise })
    await seedRunningScene(harness)

    const pending = harness.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)
    await flush()
    harness.controller.closeSession()
    hung.resolve({ status: 'cancelled' })
    await flush()

    expect(await pending).toEqual({ status: 'stale' })
    expect(harness.controller.getState().session.id).toBeNull()
  })

  it('preserves a status-only cancel response through the production HTTP adapter', async () => {
    const snapshot = createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
      runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running')],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const data = url.endsWith('/cancel')
        ? { status: 'cancelled' }
        : url.endsWith(`/scenes/${CINEMA_TEST_SCENE_A}`)
          ? snapshot
          : { session: sessionFixture(CINEMA_TEST_SESSION_ID), scenes: [snapshot.scene], messages: [], runs: [], renders: [] }
      return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = createStudioCinemaController({
      events: { subscribe: async () => undefined },
      scheduler: { schedule: () => () => undefined },
    })
    try {
      controller.attach()
      controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })
      expect(await controller.loadSceneIndex()).toBe('ok')
      controller.selectScene(CINEMA_TEST_SCENE_A)
      expect(await controller.reconcileScene(CINEMA_TEST_SCENE_A)).toBe('ok')
      expect(await controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).toEqual({ status: 'requested' })
      const scene = selectSceneState(controller.getState(), { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A })
      expect(scene?.runs[0]?.status).toBe('cancelled')
      expect(scene?.cancelRequested).toBe(false)
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/cancel'))).toHaveLength(1)
    } finally {
      controller.dispose()
      vi.unstubAllGlobals()
    }
  })

  // Task 11C7-A: a response that names another Scene never becomes this Scene's state, and the
  // pending state it would have closed is ended safely instead of hanging.
  it('ends a submit whose accepted response belongs to another Scene', async () => {
    const harness = createHarness({
      createSceneRun: async (sessionId, sceneId) => ({
        ...createTestSceneSnapshot(sessionId, sceneId),
        run: createTestRun(CINEMA_TEST_SCENE_B, 'run_foreign', 'running'),
      }),
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')

    const outcome = await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)

    expect(outcome.status).toBe('unknown')
    expect(record.submitting).toBe(false)
    expect(record.draft).toBe('draw')
    expect(record.runs).toHaveLength(0)
    expect(record.feedback?.needsReconciliation).toBe(true)
  })

  it('refuses a read whose payload belongs to another Session and still ends the pending read', async () => {
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async () => {
        reads += 1
        // The connect read is legal, every later read answers with a foreign payload.
        return reads === 1
          ? createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A)
          : createTestSceneSnapshot('session_other', CINEMA_TEST_SCENE_A)
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)

    const outcome = await harness.controller.reconcileScene(CINEMA_TEST_SCENE_A)
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)

    expect(outcome).toBe('failed')
    expect(record.snapshotStatus).toBe('error')
    expect(record.messages).toHaveLength(0)
    expect(record.feedback?.code).toBe('snapshot_failed')
  })

  // Task 11C7-B1: the detached subscription is dead, and the freshly attached one arms exactly one
  // refresh from the live wait target.
  it('ignores a connected status from the subscription that was detached', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const streamA = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    streamA.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_a', { status: 'running' }),
      }),
    )
    await flush()
    expect(harness.scheduler.pendingCount()).toBe(1)
    const readsBefore = harness.calls.getSceneSnapshot.length

    harness.controller.detach()
    expect(harness.scheduler.pendingCount()).toBe(0)

    streamA.emitStatus({ state: 'connected', attempt: 9 })
    await flush()

    expect(harness.scheduler.pendingCount()).toBe(0)
    expect(harness.calls.getSceneSnapshot.length).toBe(readsBefore)
  })

  it('arms exactly one refresh after a re-attach when the new subscription reports connected', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const streamA = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    streamA.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_a', { status: 'queued' }),
      }),
    )
    await flush()
    expect(harness.scheduler.pendingCount()).toBe(1)

    harness.controller.detach()
    expect(harness.scheduler.pendingCount()).toBe(0)

    harness.controller.attach()
    harness.controller.resumeSelectedScene()
    const fresh = lastSubscription(harness)
    fresh.emitStatus({ state: 'connected', attempt: 1 })
    await flush()

    expect(harness.scheduler.pendingCount()).toBe(1)
    // A `connected` status may legitimately start one recovery read of its own, so the tick's read is
    // counted from the moment just before the scheduler fires.
    const readsBeforeFire = harness.calls.getSceneSnapshot.length
    await harness.scheduler.fire()
    await flush()
    expect(harness.calls.getSceneSnapshot.length).toBe(readsBeforeFire + 1)
  })

  // Task 11C7-B2: a refresh read that a newer authoritative read replaced is neither applied nor
  // counted - the request having been sent is not the same as its result having been applied.
  it('does not apply or count a refresh read that a newer authoritative read replaced', async () => {
    const hung = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 2) {
          return hung.promise
        }
        if (reads === 3) {
          return createTestSceneSnapshot(sessionId, sceneId, {
            renders: [createTestRender(sceneId, 'render_new', { status: 'queued' })],
          })
        }
        return createTestSceneSnapshot(sessionId, sceneId, {
          renders: [createTestRender(sceneId, 'render_1', { status: 'queued' })],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    await harness.scheduler.fire()
    await flush()
    expect(reads).toBe(2)

    // A newer authoritative read needs a real reconnect: the disconnect closes the epoch and the next
    // `connected` opens a recovery window whose read owns a newer revision.
    stream.emitStatus({ state: 'disconnected', attempt: 1 })
    await flush()
    stream.emitStatus({ state: 'connected', attempt: 2 })
    await flush()
    expect(reads).toBe(3)

    hung.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        renders: [createTestRender(CINEMA_TEST_SCENE_A, 'render_stale', { status: 'queued' })],
      }),
    )
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.renders.some((render) => render.id === 'render_stale')).toBe(false)
    expect(record.renderRefresh.refreshes).toBe(0)
    expect(record.renderRefresh.consecutiveFailures).toBe(0)
  })

  it('keeps the created scenes after a definite failure and only fills the gap on continue', async () => {
    let createdCount = 0
    const harness = createHarness({
      createScene: (sessionId, index) => {
        if (index === 1) {
          return Promise.reject(new StudioApiRequestError('Scene persistence is unavailable', 'SERVICE_UNAVAILABLE'))
        }
        createdCount += 1
        return Promise.resolve(createTestScene(sessionId, `scene_00${createdCount}`, createdCount - 1))
      },
      getSessionSnapshot: async (sessionId) => ({
        session: sessionFixture(sessionId),
        messages: [],
        runs: [],
        renders: [],
        scenes: [createTestScene(sessionId, 'scene_001', 0)],
      }),
    })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })
    const failed = await harness.controller.initializeScenes()
    expect(failed).toEqual({ status: 'partial', createdCount: 1, code: 'scene_create_failed' })
    expect(harness.controller.getState().sceneOrder).toEqual(['scene_001'])
    expect(harness.controller.getState().initialization.status).toBe('partial')
    expect(harness.calls.createScene).toHaveLength(2)

    const created = harness.controller.continueSceneInitialization()
    const outcome = await created
    expect(outcome.status).toBe('ready')
    // The continue path reconciled the index first, so only the two missing Scenes were created.
    expect(harness.calls.getSessionSnapshot).toEqual([CINEMA_TEST_SESSION_ID])
    expect(harness.calls.createScene).toHaveLength(4)
    expect(harness.controller.getState().sceneOrder).toEqual(['scene_001', 'scene_002', 'scene_003'])
  })

  it('does not retry an unknown scene creation outcome by itself', async () => {
    const harness = createHarness({
      createScene: (sessionId, index) =>
        index === 0
          ? Promise.resolve(createTestScene(sessionId, 'scene_001', 0))
          : Promise.reject(new TypeError('Failed to fetch')),
    })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })
    const outcome = await harness.controller.initializeScenes()

    expect(outcome).toEqual({ status: 'partial', createdCount: 1, code: 'scene_create_unknown' })
    // Exactly two attempts: the workflow stopped instead of retrying the unknown request.
    expect(harness.calls.createScene).toHaveLength(2)
    const state = harness.controller.getState()
    expect(state.initialization.feedback).toEqual({ code: 'scene_create_unknown', needsReconciliation: true })
    expect(state.feedback).toEqual({ code: 'scene_create_unknown', needsReconciliation: true })
  })

  it('does not create a Scene when the continue reconcile fails', async () => {
    const harness = createHarness({
      createScene: (sessionId, index) =>
        index === 0
          ? Promise.resolve(createTestScene(sessionId, 'scene_001', 0))
          : Promise.reject(new TypeError('Failed to fetch')),
      getSessionSnapshot: async () => {
        throw new TypeError('Failed to fetch')
      },
    })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })
    const first = await harness.controller.initializeScenes()
    expect(first).toEqual({ status: 'partial', createdCount: 1, code: 'scene_create_unknown' })
    expect(harness.calls.createScene).toHaveLength(2)

    // Two concurrent continues join one reconciliation, and a failed reconciliation creates nothing.
    const [a, b] = [harness.controller.continueSceneInitialization(), harness.controller.continueSceneInitialization()]
    await expect(a).resolves.toEqual({ status: 'partial', createdCount: 1, code: 'snapshot_failed' })
    await expect(b).resolves.toEqual({ status: 'partial', createdCount: 1, code: 'snapshot_failed' })
    expect(harness.calls.getSessionSnapshot).toHaveLength(1)
    expect(harness.calls.createScene).toHaveLength(2)
    // No authoritative read happened at all, so nothing was assumed about the index.
    expect(harness.calls.getSceneSnapshot).toHaveLength(0)
  })

  it('reads an existing session index without ever creating a scene', async () => {
    const harness = createHarness({
      getSessionSnapshot: async (sessionId) => ({
        session: sessionFixture(sessionId),
        messages: [],
        runs: [],
        renders: [],
        scenes: [
          createTestScene(sessionId, CINEMA_TEST_SCENE_A, 0),
          createTestScene(sessionId, CINEMA_TEST_SCENE_B, 1),
        ],
      }),
    })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })
    await expect(harness.controller.loadSceneIndex()).resolves.toBe('ok')

    expect(harness.controller.getState().sceneOrder).toEqual([CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    expect(harness.calls.createScene).toHaveLength(0)
    expect(harness.controller.getState().initialization.status).toBe('idle')
  })

  it('keeps the selection and the draft across an index refresh and closes the stream with the Scene', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'typed')

    // A refresh that still contains the Scene keeps both the selection (composite key) and the draft.
    await expect(harness.controller.loadSceneIndex()).resolves.toBe('ok')
    expect(harness.controller.getState().selectedSceneId).toBe(CINEMA_TEST_SCENE_A)
    expect(stream.isAborted()).toBe(false)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).draft).toBe('typed')

    // A Scene that disappears from the index also loses the selection, and its stream is closed.
    harness.server.setScenes(CINEMA_TEST_SESSION_ID, [CINEMA_TEST_SCENE_B])
    await expect(harness.controller.loadSceneIndex()).resolves.toBe('ok')
    expect(harness.controller.getState().selectedSceneId).toBeNull()
    expect(stream.isAborted()).toBe(true)
    expect(selectSceneState(harness.controller.getState(), {
      sessionId: CINEMA_TEST_SESSION_ID,
      sceneId: CINEMA_TEST_SCENE_A,
    })).toBeNull()
  })

  it('does not let an index read that ran earlier remove a Scene created afterwards', async () => {
    const firstSessionRead = createDeferred<StudioSessionSnapshot>()
    const serverSceneIds: StudioScene[] = [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)]
    let readIndex = 0
    const harness = createHarness({
      getSessionSnapshot: (sessionId) => {
        readIndex += 1
        if (readIndex === 1) {
          // The read this spec controls returns a snapshot taken before the append existed.
          return firstSessionRead.promise
        }
        return Promise.resolve({
          session: sessionFixture(sessionId),
          messages: [],
          runs: [],
          renders: [],
          scenes: [...serverSceneIds],
        })
      },
    })
    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID, projectId: 'project_1' })

    // The index read owns the lane; the append queues behind it and therefore cannot be clobbered by
    // the older snapshot it returns.
    const read = harness.controller.loadSceneIndex()
    const append = harness.controller.appendScene()
    await flush()
    expect(harness.calls.createScene).toHaveLength(0)

    firstSessionRead.resolve({
      session: sessionFixture(CINEMA_TEST_SESSION_ID),
      messages: [],
      runs: [],
      renders: [],
      scenes: [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)],
    })
    await expect(read).resolves.toBe('ok')
    await append

    expect(harness.calls.createScene).toHaveLength(1)
    expect(harness.controller.getState().sceneOrder).toEqual([CINEMA_TEST_SCENE_A, 'scene_001'])
  })

  it('lets a creation that answered after a session switch leave the new session untouched', async () => {
    const creates: Array<Deferred<StudioScene>> = []
    const harness = createHarness({
      createScene: (_sessionId, callIndex) => {
        const deferred = createDeferred<StudioScene>()
        creates[callIndex] = deferred
        return deferred.promise
      },
    })

    harness.controller.openSession({ sessionId: 'session_a' })
    const workflowA = harness.controller.initializeScenes()
    await flush()

    harness.controller.openSession({ sessionId: 'session_b' })
    const workflowB = harness.controller.initializeScenes()
    await flush()

    // The old workflow answers after the switch: it must not write into B nor clear B's workflow slot.
    creates[0]?.resolve(createTestScene('session_a', 'scene_a1', 0))
    await expect(workflowA).resolves.toEqual({ status: 'stale' })
    expect(harness.controller.getState().session.id).toBe('session_b')
    expect(harness.controller.getState().sceneOrder).toEqual([])

    for (let index = 1; index < 4; index += 1) {
      creates[index]?.resolve(createTestScene('session_b', `scene_b${index}`, index - 1))
      await flush()
    }
    await expect(workflowB).resolves.toEqual({ status: 'ready', createdCount: 3 })
    expect(harness.controller.getState().sceneOrder).toHaveLength(3)
  })

  it('serializes an append through the session mutation lane and has no client-side cap', async () => {
    const firstAppend = createDeferred<StudioScene>()
    const harness = createHarness({
      createScene: (sessionId, index) =>
        index === 0 ? firstAppend.promise : Promise.resolve(createTestScene(sessionId, `scene_appended_${index}`, index)),
    })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })
    const first = harness.controller.appendScene()
    const second = harness.controller.appendScene()

    // The lane holds the second request until the first one answers, and the pending flag stays true
    // until the lane is really idle.
    await flush()
    expect(harness.calls.createScene).toHaveLength(1)
    expect(harness.controller.getState().sceneMutationPending).toBe(true)

    firstAppend.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_0001', 0))
    await first
    await second

    expect(harness.calls.createScene).toHaveLength(2)
    expect(harness.controller.getState().sceneOrder).toEqual(['scene_0001', 'scene_appended_1'])
    expect(harness.controller.getState().sceneMutationPending).toBe(false)
  })

  it('does not over-create when an append fills the initialization target first', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    const append = harness.controller.appendScene()
    const workflow = harness.controller.initializeScenes()
    await append
    const outcome = await workflow

    // The append answered first, so initialization only adds the Scenes that are still missing.
    expect(outcome).toEqual({ status: 'ready', createdCount: 3 })
    expect(harness.controller.getState().sceneOrder).toEqual([CINEMA_TEST_SCENE_A, 'scene_001', 'scene_002'])
    expect(harness.calls.createScene).toHaveLength(2)
  })

  it('submits with the captured identity, project, provider config and draft version', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw a circle')

    const outcome = await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)

    expect(outcome).toEqual({ status: 'accepted', runId: 'run_2' })
    expect(harness.calls.createSceneRun).toEqual([
      {
        sessionId: CINEMA_TEST_SESSION_ID,
        sceneId: CINEMA_TEST_SCENE_A,
        input: {
          inputText: 'draw a circle',
          projectId: 'project_1',
          customApiConfig: { apiUrl: 'http://provider.invalid', apiKey: 'k', model: 'm' },
        },
      },
    ])
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.draft).toBe('')
    expect(record.submitting).toBe(false)
    expect(readStudioCinemaActiveRun(record)?.id).toBe('run_2')
    expect(record.needsReconciliation).toBe(false)
  })

  it('refuses a submit until the Scene snapshot is authoritative', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')

    // Selected but not yet connected: the absence of an active Run is not proven, so nothing is sent.
    const refused = await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    expect(refused).toEqual({ status: 'ignored_not_ready', reason: 'loading' })
    expect(harness.calls.createSceneRun).toHaveLength(0)

    lastSubscription(harness).emitStatus({ state: 'connected', attempt: 1 })
    await flush()
    await expect(harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)).resolves.toEqual({
      status: 'accepted',
      runId: 'run_2',
    })
  })

  it('refuses a submit while a restored active Run exists and cancels that Run instead', async () => {
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) =>
        createTestSceneSnapshot(sessionId, sceneId, {
          runs: [createTestRun(sceneId, 'run_restored', 'running', sessionId)],
        }),
      cancelRun: async (runId) => ({
        status: 'cancelled',
        run: createTestRun(CINEMA_TEST_SCENE_A, runId, 'cancelled'),
      }),
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')

    const refused = await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    expect(refused).toEqual({ status: 'ignored_not_ready', reason: 'active_run' })
    expect(harness.calls.createSceneRun).toHaveLength(0)

    // The restored Run is cancelable, and cancelling it frees the Scene for a new submit.
    expect(selectStudioCinemaSceneView(harness.controller.getState(), CINEMA_TEST_SCENE_A)?.canCancel).toBe(true)
    await expect(harness.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).resolves.toEqual({ status: 'requested' })
    expect(harness.calls.cancelRun).toEqual(['run_restored'])
    expect(readStudioCinemaActiveRun(sceneRecord(harness, CINEMA_TEST_SCENE_A))).toBeNull()
    await expect(harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)).resolves.toEqual({
      status: 'accepted',
      runId: 'run_2',
    })
  })

  it('never cancels a terminal Run and refuses a duplicate cancel of the same Scene', async () => {
    const cancel = createDeferred<StudioCinemaCancelResponse>()
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) =>
        createTestSceneSnapshot(sessionId, sceneId, {
          runs: [createTestRun(sceneId, 'run_done', 'completed', sessionId)],
        }),
      cancelRun: () => cancel.promise,
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)

    await expect(harness.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).resolves.toEqual({
      status: 'no_active_run',
    })
    expect(harness.calls.cancelRun).toHaveLength(0)

    // A running Run can be cancelled once; a second request of the same Scene is refused locally.
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')
    await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    const first = harness.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)
    const duplicate = harness.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)
    await expect(duplicate).resolves.toEqual({ status: 'ignored_busy' })

    cancel.resolve({ status: 'cancelled' })
    await expect(first).resolves.toEqual({ status: 'requested' })
    expect(harness.calls.cancelRun).toHaveLength(1)
  })

  it('drops a cancel record that names another Run, Scene or Session', async () => {
    const harness = createHarness({
      cancelRun: async (runId) => ({
        status: 'cancelled',
        run: createTestRun(CINEMA_TEST_SCENE_B, runId, 'cancelled'),
      }),
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')
    await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)

    await expect(harness.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)).resolves.toEqual({ status: 'failed', code: 'run_cancel_failed' })

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.cancelRequested).toBe(false)
    // The foreign record is dropped: the Scene keeps its own Run and its status.
    expect(record.runs.find((run) => run.id === 'run_2')?.status).toBe('running')
    expect(readStudioCinemaActiveRun(record)?.id).toBe('run_2')
  })

  it('reports a throwing provider resolver as a stable local failure', async () => {
    const harness = createHarness({ providerThrows: true })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')

    await expect(harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)).resolves.toEqual({
      status: 'provider_unavailable',
    })
    expect(harness.calls.createSceneRun).toHaveLength(0)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).feedback).toEqual({
      code: 'provider_unavailable',
      needsReconciliation: false,
    })
  })

  it('ignores a second submit of the same scene while another scene stays usable', async () => {
    const pendingA = createDeferred<StudioCreateSceneRunResponse>()
    const pendingB = createDeferred<StudioCreateSceneRunResponse>()
    const harness = createHarness({
      createSceneRun: (_sessionId, sceneId) =>
        sceneId === CINEMA_TEST_SCENE_A ? pendingA.promise : pendingB.promise,
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_B)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'a')
    harness.controller.setDraft(CINEMA_TEST_SCENE_B, 'b')

    const first = harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    const duplicate = harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    const sibling = harness.controller.submitSceneRun(CINEMA_TEST_SCENE_B)

    // The duplicate of a busy Scene is refused locally; the sibling Scene is not blocked by it.
    await expect(duplicate).resolves.toEqual({ status: 'ignored_busy' })
    expect(harness.calls.createSceneRun).toHaveLength(2)
    expect(harness.calls.createSceneRun.map((call) => call.sceneId)).toEqual([
      CINEMA_TEST_SCENE_A,
      CINEMA_TEST_SCENE_B,
    ])

    pendingA.resolve(createAcceptedResponse(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'run_2'))
    pendingB.resolve(createAcceptedResponse(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B, 'run_3'))
    await expect(first).resolves.toEqual({ status: 'accepted', runId: 'run_2' })
    await expect(sibling).resolves.toEqual({ status: 'accepted', runId: 'run_3' })
    expect(readStudioCinemaActiveRun(sceneRecord(harness, CINEMA_TEST_SCENE_A))?.id).toBe('run_2')
    expect(readStudioCinemaActiveRun(sceneRecord(harness, CINEMA_TEST_SCENE_B))?.id).toBe('run_3')
  })

  it('writes a late accepted response only to the scene that was submitted', async () => {
    const pending = createDeferred<StudioCreateSceneRunResponse>()
    const harness = createHarness({ createSceneRun: () => pending.promise })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'for a')
    harness.controller.setDraft(CINEMA_TEST_SCENE_B, 'typed while waiting')

    const submit = harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    // The user switches to scene B and keeps typing there.
    harness.controller.selectScene(CINEMA_TEST_SCENE_B)
    harness.controller.setDraft(CINEMA_TEST_SCENE_B, 'typed while waiting!')

    pending.resolve(createAcceptedResponse(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'run_2'))
    await expect(submit).resolves.toEqual({ status: 'accepted', runId: 'run_2' })

    expect(readStudioCinemaActiveRun(sceneRecord(harness, CINEMA_TEST_SCENE_A))?.id).toBe('run_2')
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).draft).toBe('')
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_B).draft).toBe('typed while waiting!')
    expect(harness.controller.getState().selectedSceneId).toBe(CINEMA_TEST_SCENE_B)
  })

  it('discards a pending response after a session switch', async () => {
    const pending = createDeferred<StudioCreateSceneRunResponse>()
    const harness = createHarness({ createSceneRun: () => pending.promise })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')

    const submit = harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    harness.controller.openSession({ sessionId: 'session_other' })

    pending.resolve(createAcceptedResponse(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'run_2'))
    await expect(submit).resolves.toEqual({ status: 'stale' })

    const state = harness.controller.getState()
    expect(state.session.id).toBe('session_other')
    expect(state.sceneOrder).toEqual([])
    expect(state.scenes).toEqual({})
  })

  it('stops claiming an outcome after an unknown submit and only a successful reconcile clears it', async () => {
    let reconcile: 'fail' | 'ok' = 'fail'
    const harness = createHarness({
      createSceneRun: () => Promise.reject(new TypeError('Failed to fetch')),
      getSceneSnapshot: async (sessionId, sceneId) => {
        if (reconcile === 'fail') {
          throw new TypeError('Failed to fetch')
        }
        return createTestSceneSnapshot(sessionId, sceneId)
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')

    const outcome = await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)
    expect(outcome).toEqual({ status: 'unknown', code: 'run_submit_unknown' })
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).draft).toBe('draw')

    // A failed reconciliation keeps the flag, and a blind resubmit is refused while it is set.
    await expect(harness.controller.reconcileScene(CINEMA_TEST_SCENE_A)).resolves.toBe('failed')
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).needsReconciliation).toBe(true)
    await expect(harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)).resolves.toEqual({
      status: 'ignored_not_ready',
      reason: 'snapshot_failed',
    })
    expect(harness.calls.createSceneRun).toHaveLength(1)

    reconcile = 'ok'
    await expect(harness.controller.reconcileScene(CINEMA_TEST_SCENE_A)).resolves.toBe('ok')
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).needsReconciliation).toBe(false)
    expect(readStudioCinemaSceneEligibility(sceneRecord(harness, CINEMA_TEST_SCENE_A)).canSubmit).toBe(true)
  })

  it('keeps a provider-incomplete submit on the client and keeps the draft', async () => {
    const harness = createHarness({ providerIncomplete: true })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')

    const outcome = await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)

    expect(outcome).toEqual({ status: 'provider_incomplete' })
    expect(harness.calls.createSceneRun).toHaveLength(0)
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.draft).toBe('draw')
    expect(record.feedback).toEqual({ code: 'provider_incomplete', needsReconciliation: false })
  })

  it('cancels with the captured run id and narrows the cancel response', async () => {
    const harness = createHarness({
      cancelRun: async (runId) => ({
        status: 'cancelled',
        run: {
          ...createTestRun(CINEMA_TEST_SCENE_A, runId, 'cancelled'),
          error: 'internal failure text',
          ownerId: 'owner_1',
        },
      }),
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    harness.controller.setDraft(CINEMA_TEST_SCENE_A, 'draw')
    await harness.controller.submitSceneRun(CINEMA_TEST_SCENE_A)

    const outcome = await harness.controller.cancelSceneRun(CINEMA_TEST_SCENE_A)

    expect(outcome).toEqual({ status: 'requested' })
    expect(harness.calls.cancelRun).toEqual(['run_2'])
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.cancelRequested).toBe(false)
    const cancelled = record.runs.find((run) => run.id === 'run_2')
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled && 'error' in cancelled).toBe(false)
    expect(cancelled && 'ownerId' in cancelled).toBe(false)
  })

  it('waits for a real connection before reading the Scene snapshot', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    await flush()
    // Selected, subscribing, but not connected: no authoritative read has been made.
    expect(harness.calls.getSceneSnapshot).toHaveLength(0)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).snapshotStatus).toBe('loading')

    lastSubscription(harness).emitStatus({ state: 'connected', attempt: 0 })
    await flush()
    expect(harness.calls.getSceneSnapshot).toEqual([CINEMA_TEST_SCENE_A])
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).snapshotStatus).toBe('ready')
  })

  it('treats the transport status and the backend connection frame as one recovery', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    stream.emit(createTestFrame('studio.connected', { timestamp: 1700 }))
    await flush()

    // Both signals describe the same connection: one window, one read.
    expect(harness.calls.getSceneSnapshot).toHaveLength(1)
  })

  it('runs a fresh recovery on every reconnection', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    expect(harness.calls.getSceneSnapshot).toHaveLength(1)

    stream.emitStatus({ state: 'reconnecting', attempt: 1 })
    await flush()
    expect(harness.calls.getSceneSnapshot).toHaveLength(1)

    stream.emitStatus({ state: 'connected', attempt: 1 })
    await flush()
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).snapshotStatus).toBe('ready')
  })

  it('drops a snapshot that an older recovery produced after a newer one started', async () => {
    const firstRead = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 1) {
          return firstRead.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId, {
          messages: [
            {
              id: 'message_new',
              sessionId,
              sceneId,
              role: 'assistant',
              agent: 'builder',
              parts: [],
              createdAt: '2026-03-22T00:00:00.000Z',
              updatedAt: '2026-03-22T00:00:00.000Z',
            },
          ],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    // A manual reconciliation of the same Scene starts a newer read and owns the result.
    await expect(harness.controller.reconcileScene(CINEMA_TEST_SCENE_A)).resolves.toBe('ok')
    firstRead.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [
          {
            id: 'message_old',
            sessionId: CINEMA_TEST_SESSION_ID,
            sceneId: CINEMA_TEST_SCENE_A,
            role: 'assistant',
            agent: 'builder',
            parts: [],
            createdAt: '2026-03-22T00:00:00.000Z',
            updatedAt: '2026-03-22T00:00:00.000Z',
          },
        ],
      }),
    )
    await flush()

    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).messages.map((message) => message.id)).toEqual([
      'message_new',
    ])
  })

  it('never claims completeness for an unprovable recovery window and converges at a checkpoint', async () => {
    const firstSnapshot = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 1) {
          return firstSnapshot.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId, {
          messages: [assistantMessage(sessionId, sceneId, 'one two')],
          runs: [createTestRun(sceneId, 'run_buffered', 'completed', sessionId)],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    // Inside the window: record events are idempotent and are replayed; the assistant deltas are
    // discarded because the protocol has no cursor to prove they are not already inside the snapshot.
    stream.emit(createTestRunFrame(createTestRun(CINEMA_TEST_SCENE_A, 'run_buffered', 'running')))
    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'one '))
    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'two'))
    firstSnapshot.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [assistantMessage(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'one two')],
      }),
    )
    await flush()

    const afterRecovery = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(afterRecovery.runs.map((run) => run.id)).toEqual(['run_buffered'])
    const message = afterRecovery.messages[0]
    const text = message?.role === 'assistant' ? message.parts[0] : null
    expect(text?.type === 'text' ? text.text : '').toBe('one two')
    expect(afterRecovery.convergencePending).toBe(true)
    expect(afterRecovery.resyncedAt).toBe(1_700_000_000_000)
    expect(afterRecovery.feedback?.code).toBe('stream_resync')

    // A terminal Run is a determinable checkpoint: one authoritative read converges the Scene.
    stream.emit(createTestRunFrame(createTestRun(CINEMA_TEST_SCENE_A, 'run_buffered', 'completed')))
    await flush()
    expect(reads).toBe(2)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).convergencePending).toBe(false)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).runs[0]?.status).toBe('completed')
  })

  it('never claims completeness when the second recovery read also loses events', async () => {
    const firstSnapshot = createDeferred<StudioSceneSnapshot>()
    const secondSnapshot = createDeferred<StudioSceneSnapshot>()
    let snapshotReads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        snapshotReads += 1
        if (snapshotReads === 1) {
          return firstSnapshot.promise
        }
        if (snapshotReads === 2) {
          return secondSnapshot.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId)
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    for (let index = 0; index <= STUDIO_CINEMA_RECOVERY_BUFFER_LIMIT; index += 1) {
      stream.emit(createTestRunFrame(createTestRun(CINEMA_TEST_SCENE_A, `run_${index}`, 'running')))
    }
    firstSnapshot.resolve(createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A))
    await flush()
    // The overflow triggered exactly one bounded follow-up read.
    expect(snapshotReads).toBe(2)

    // Events lost while the second read is in flight must not be silently dropped while the client
    // claims to be in sync: a discarded delta and a second overflow keep the convergence pending.
    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'lost'))
    for (let index = 0; index <= STUDIO_CINEMA_RECOVERY_BUFFER_LIMIT; index += 1) {
      stream.emit(createTestRunFrame(createTestRun(CINEMA_TEST_SCENE_A, `late_${index}`, 'running')))
    }
    secondSnapshot.resolve(createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A))
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(snapshotReads).toBe(2)
    expect(record.resyncedAt).toBe(1_700_000_000_000)
    expect(record.feedback?.code).toBe('stream_resync')
    expect(record.convergencePending).toBe(true)
    expect(selectStudioCinemaSceneView(harness.controller.getState(), CINEMA_TEST_SCENE_A)?.convergencePending).toBe(
      true,
    )
  })

  it('never reports a ready snapshot after a failed recovery', async () => {
    const harness = createHarness({
      getSceneSnapshot: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    lastSubscription(harness).emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.snapshotStatus).toBe('error')
    expect(record.needsReconciliation).toBe(true)
    expect(selectStudioCinemaSceneView(harness.controller.getState(), CINEMA_TEST_SCENE_A)?.userStatus).toEqual({
      code: 'run_submit_unknown',
      kind: 'recoverable',
    })
  })

  it('aborts the previous stream on a switch and ignores a frame of the aborted stream', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])

    const streamA = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    expect(streamA.options).toMatchObject({
      scope: { kind: 'scene', sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A },
    })

    harness.controller.selectScene(CINEMA_TEST_SCENE_B)
    await flush()
    expect(streamA.isAborted()).toBe(true)
    expect(harness.subscriptions).toHaveLength(2)

    streamA.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'late'))
    await flush()
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).messages).toHaveLength(0)
  })

  it('ignores sibling, legacy, malformed and unknown frames and only tracks connection frames', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    await flush()

    const stream = lastSubscription(harness)
    stream.emit(
      createTestFrame('assistant.text', {
        ...createTestScopedProperties(CINEMA_TEST_SCENE_B),
        text: 'sibling',
      }),
    )
    stream.emit(createTestFrame('assistant.text', { ...createTestScopedProperties(undefined), text: 'legacy' }))
    stream.emit(createTestFrame('assistant.text', { ...createTestScopedProperties(CINEMA_TEST_SCENE_A), text: 7 }))
    stream.emit(createTestFrame('unknown.type', createTestScopedProperties(CINEMA_TEST_SCENE_A)))
    stream.emit(null)
    stream.emit(createTestFrame('studio.connected', { timestamp: 1700 }))
    // Fixture correction 11C5-H3: `streamState` is defined by the transport status channel, not by a
    // data frame (see the reconnect case above and the disconnection case below), so the connection is
    // reported the way the transport reports it. The frames above still have to be ignored.
    stream.emitStatus({ state: 'connected', attempt: 1 })
    await flush()

    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).messages).toHaveLength(0)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_B).messages).toHaveLength(0)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).streamState).toBe('connected')
    expect(harness.calls.getSceneSnapshot).toEqual([CINEMA_TEST_SCENE_A])
  })

  it('never rewrites a run outcome when the connection drops', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)

    stream.emit(createTestRunFrame(createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'completed')))
    stream.emitStatus({ state: 'disconnected', attempt: 4 })
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.runs[0]?.status).toBe('completed')
    expect(record.streamState).toBe('disconnected')
    const view = selectStudioCinemaSceneView(harness.controller.getState(), CINEMA_TEST_SCENE_A)
    expect(view?.userStatus).toEqual({ code: 'stream_disconnected', kind: 'connection' })
  })

  it('aborts the stream on dispose and drops every later write', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)

    const before = harness.controller.getState()
    harness.controller.dispose()

    expect(stream.isAborted()).toBe(true)
    expect(harness.controller.isDisposed()).toBe(true)

    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'after dispose'))
    await flush()
    expect(harness.controller.getState()).toBe(before)
    expect(harness.calls.getSceneSnapshot).toHaveLength(1)
  })

  it('aborts the in-flight request and stays reusable after a detach', async () => {
    const pendingCreate = createDeferred<StudioScene>()
    const harness = createHarness({
      createScene: () => pendingCreate.promise,
    })

    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })
    const append = harness.controller.appendScene()
    await flush()
    expect(harness.calls.createScene).toHaveLength(1)

    harness.controller.detach()
    expect(harness.controller.isDisposed()).toBe(false)
    expect(harness.controller.isAttached()).toBe(false)

    // The queued result is stale, and the instance can be re-armed for the same Session.
    pendingCreate.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_detached', 0))
    await expect(append).resolves.toEqual({ status: 'stale' })
    harness.controller.attach()
    expect(harness.controller.isAttached()).toBe(true)
    expect(harness.controller.getState().sceneOrder).toEqual([])
  })

  it('reports a failing subscription without an unhandled rejection', async () => {
    const harness = createHarness({
      subscribe: () => Promise.reject(new Error('event bus unavailable')),
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.streamState).toBe('disconnected')
    // The Scene record stays usable: a transport failure is not a Run/Render outcome.
    expect(record.runs).toHaveLength(0)
    expect(selectStudioCinemaSceneView(harness.controller.getState(), CINEMA_TEST_SCENE_A)?.userStatus).toEqual({
      code: 'stream_disconnected',
      kind: 'connection',
    })
  })

  it('keeps a newer sibling render visible while the selected scene keeps its own records', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)

    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_a', {
          attachments: [{ kind: 'file', path: 'data:video/mp4;base64,AAAA', mimeType: 'video/mp4' }],
        }),
      }),
    )
    await flush()

    const view = selectStudioCinemaSceneView(harness.controller.getState(), CINEMA_TEST_SCENE_A)
    expect(view?.display.playableUrl).toBe('data:video/mp4;base64,AAAA')
    expect(selectStudioCinemaSceneView(harness.controller.getState(), CINEMA_TEST_SCENE_B)?.display.render).toBeNull()
  })

  it('queues an index read behind a creation and never runs two Scene requests at once', async () => {
    const creates: Array<Deferred<StudioScene>> = []
    const indexReads: Array<Deferred<StudioSessionSnapshot>> = []
    const counter = createInFlightCounter()
    const harness = createHarness({
      createScene: (_sessionId, callIndex) => {
        const deferred = createDeferred<StudioScene>()
        creates[callIndex] = deferred
        return counter.track(deferred.promise)
      },
      getSessionSnapshot: () => {
        const deferred = createDeferred<StudioSessionSnapshot>()
        indexReads.push(deferred)
        return counter.track(deferred.promise)
      },
    })
    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })

    const append = harness.controller.appendScene()
    await flush()
    expect(harness.calls.createScene).toHaveLength(1)

    // Both entries arrive while the creation is genuinely in flight, not in the same tick as its start.
    const index = harness.controller.loadSceneIndex()
    const secondAppend = harness.controller.appendScene()
    await flush()
    expect(harness.calls.getSessionSnapshot).toHaveLength(0)
    expect(harness.calls.createScene).toHaveLength(1)

    creates[0]?.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_0001', 0))
    await append
    await flush()
    // Only the index read starts now; the second append stays queued behind it.
    expect(harness.calls.getSceneSnapshot).toHaveLength(0)
    expect(harness.calls.createScene).toHaveLength(1)

    indexReads[0]?.resolve({
      session: sessionFixture(CINEMA_TEST_SESSION_ID),
      messages: [],
      runs: [],
      renders: [],
      scenes: [createTestScene(CINEMA_TEST_SESSION_ID, 'scene_0001', 0)],
    })
    await expect(index).resolves.toBe('ok')
    await flush()
    expect(harness.calls.createScene).toHaveLength(2)
    creates[1]?.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_0002', 1))
    await secondAppend

    expect(counter.max()).toBe(1)
    expect(harness.controller.getState().sceneOrder).toEqual(['scene_0001', 'scene_0002'])
    expect(harness.controller.getState().sceneMutationPending).toBe(false)
  })

  it('does not over-create when an append competes with initialization for the target', async () => {
    const creates: Array<Deferred<StudioScene>> = []
    const counter = createInFlightCounter()
    const harness = createHarness({
      createScene: (_sessionId, callIndex) => {
        const deferred = createDeferred<StudioScene>()
        creates[callIndex] = deferred
        return counter.track(deferred.promise)
      },
    })
    harness.controller.openSession({ sessionId: CINEMA_TEST_SESSION_ID })

    const workflow = harness.controller.initializeScenes()
    await flush()
    expect(harness.calls.createScene).toHaveLength(1)

    // The append waits for the creation in flight instead of creating a second Scene beside it.
    const append = harness.controller.appendScene()
    await flush()
    expect(harness.calls.createScene).toHaveLength(1)

    creates[0]?.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_0000', 0))
    await flush()
    // The queued append ran next and counts toward the target, so only one more Scene is created.
    expect(harness.calls.createScene).toHaveLength(2)
    creates[1]?.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_appended', 1))
    await append
    await flush()
    expect(harness.calls.createScene).toHaveLength(3)
    creates[2]?.resolve(createTestScene(CINEMA_TEST_SESSION_ID, 'scene_0002', 2))

    await expect(workflow).resolves.toEqual({ status: 'ready', createdCount: 3 })
    expect(counter.max()).toBe(1)
    expect(harness.controller.getState().sceneOrder).toHaveLength(3)
  })

  it('drops a queued lane task whose Session switched before it started', async () => {
    const firstCreate = createDeferred<StudioScene>()
    const harness = createHarness({
      createScene: (sessionId, callIndex) =>
        callIndex === 0
          ? firstCreate.promise
          : Promise.resolve(createTestScene(sessionId, `scene_late_${callIndex}`, callIndex)),
    })
    harness.controller.openSession({ sessionId: 'session_a' })

    const append = harness.controller.appendScene()
    const refresh = harness.controller.loadSceneIndex()
    await flush()
    expect(harness.calls.createScene).toHaveLength(1)

    harness.controller.openSession({ sessionId: 'session_b' })
    firstCreate.resolve(createTestScene('session_a', 'scene_a1', 0))

    // Neither queued task may issue a request for the Session that is gone.
    await expect(append).resolves.toEqual({ status: 'stale' })
    await expect(refresh).resolves.toBe('stale')
    expect(harness.calls.createScene).toHaveLength(1)
    expect(harness.calls.getSessionSnapshot).toHaveLength(0)
    expect(harness.controller.getState().session.id).toBe('session_b')
    expect(harness.controller.getState().sceneOrder).toEqual([])
    expect(harness.controller.getState().sceneMutationPending).toBe(false)
  })

  it('never accepts a recovery snapshot that a disconnection invalidated', async () => {
    const recovery = createDeferred<StudioSceneSnapshot>()
    const harness = createHarness({ getSceneSnapshot: () => recovery.promise })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()
    expect(harness.calls.getSceneSnapshot).toHaveLength(1)

    // The connection drops before the snapshot answers, and no new epoch connected yet.
    stream.emitStatus({ state: 'disconnected', attempt: 0 })
    recovery.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [assistantMessage(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'unproven')],
      }),
    )
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.snapshotStatus).toBe('loading')
    expect(record.messages).toHaveLength(0)
    expect(record.convergencePending).toBe(false)
    expect(record.streamState).toBe('disconnected')
  })

  it('drops a Scene read whose stream another selection replaced', async () => {
    const recoveryA = createDeferred<StudioSceneSnapshot>()
    const harness = createHarness({
      getSceneSnapshot: (sessionId, sceneId) =>
        sceneId === CINEMA_TEST_SCENE_A
          ? recoveryA.promise
          : Promise.resolve(createTestSceneSnapshot(sessionId, sceneId)),
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    lastSubscription(harness).emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    // Selection moves to B, which has not connected yet: A's read belongs to a view that is gone.
    harness.controller.selectScene(CINEMA_TEST_SCENE_B)
    await flush()
    expect(harness.calls.getSceneSnapshot).toEqual([CINEMA_TEST_SCENE_A])

    recoveryA.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [assistantMessage(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'unproven')],
      }),
    )
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.snapshotStatus).toBe('loading')
    expect(record.messages).toHaveLength(0)
  })

  it('drops an older epoch recovery response after a newer epoch connected', async () => {
    const firstEpoch = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 1) {
          return firstEpoch.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId, {
          messages: [assistantMessage(sessionId, sceneId, 'authoritative')],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    stream.emitStatus({ state: 'reconnecting', attempt: 1 })
    stream.emitStatus({ state: 'connected', attempt: 1 })
    await flush()
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)

    firstEpoch.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [assistantMessage(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'stale epoch')],
      }),
    )
    await flush()

    expect(readAssistantText(harness, CINEMA_TEST_SCENE_A)).toBe('authoritative')
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).snapshotStatus).toBe('ready')
  })

  it('applies a manual reconciliation that never pretends to be a stream recovery', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    // No stream ever connected: there is no recovery window, and the explicit read owns itself.
    await expect(harness.controller.reconcileScene(CINEMA_TEST_SCENE_A)).resolves.toBe('ok')
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).snapshotStatus).toBe('ready')
  })

  it('converges at a terminal Run that arrived inside the recovery window', async () => {
    const firstSnapshot = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 1) {
          return firstSnapshot.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId, {
          messages: [assistantMessage(sessionId, sceneId, 'one two')],
          runs: [createTestRun(sceneId, 'run_window', 'completed', sessionId)],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    // Inside the window: the deltas are discarded and the terminal Run is a buffered record.
    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'one '))
    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'two'))
    stream.emit(createTestRunFrame(createTestRun(CINEMA_TEST_SCENE_A, 'run_window', 'completed')))
    firstSnapshot.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [assistantMessage(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'one ')],
      }),
    )
    await flush()

    // The buffered terminal Run is as determinable as a live one: one read follows on its own and
    // the authoritative text replaces the incomplete snapshot without another event or a user action.
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)
    expect(readAssistantText(harness, CINEMA_TEST_SCENE_A)).toBe('one two')
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).convergencePending).toBe(false)
  })

  it('keeps the convergence pending when the bounded second read fails and never loops', async () => {
    const firstSnapshot = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 1) {
          return firstSnapshot.promise
        }
        void sessionId
        void sceneId
        throw new TypeError('Failed to fetch')
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    for (let index = 0; index <= STUDIO_CINEMA_RECOVERY_BUFFER_LIMIT; index += 1) {
      stream.emit(createTestRunFrame(createTestRun(CINEMA_TEST_SCENE_A, `run_${index}`, 'running')))
    }
    firstSnapshot.resolve(createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A))
    await flush()
    await flush()

    // The loss of the first window survives the failed second read, and the bounded policy holds:
    // exactly two reads happened and no further one is scheduled.
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.convergencePending).toBe(true)
    expect(record.resyncedAt).toBe(1_700_000_000_000)
    expect(record.snapshotStatus).toBe('error')
  })

  it('keeps the pending convergence when text arrived while the checkpoint read was in flight', async () => {
    const firstSnapshot = createDeferred<StudioSceneSnapshot>()
    const checkpointSnapshot = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 1) {
          return firstSnapshot.promise
        }
        if (reads === 2) {
          return checkpointSnapshot.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId)
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()

    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'lost in the window'))
    firstSnapshot.resolve(createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A))
    await flush()
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).convergencePending).toBe(true)

    // A live terminal Run schedules the checkpoint read; a delta arriving while that read is in
    // flight cannot be covered by the snapshot it returns, because the snapshot replaces the list.
    stream.emit(createTestRunFrame(createTestRun(CINEMA_TEST_SCENE_A, 'run_checkpoint', 'completed')))
    await flush()
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)

    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'arrived during the read'))
    checkpointSnapshot.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [assistantMessage(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 'authoritative')],
      }),
    )
    await flush()

    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).convergencePending).toBe(true)
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)
  })

  it('starts one bounded refresh while the selected Scene has an unfinished Manim render', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)

    stream.emit(
      createTestFrame('run.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        run: createTestRun(CINEMA_TEST_SCENE_A, 'run_done', 'completed'),
      }),
    )
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'queued' }),
      }),
    )
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    // The Agent Run is finished and the render is not: the loop follows the render.
    expect(record.renderRefresh.status).toBe('active')
    expect(harness.scheduler.pendingCount()).toBe(1)
    expect(harness.scheduler.pending[0]?.delayMs).toBe(STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS)
    expect(selectStudioCinemaSceneView(harness.controller.getState(), CINEMA_TEST_SCENE_A)?.activeRender?.status).toBe(
      'queued',
    )
  })

  it('refreshes the selected Scene and stops the loop once the render finished', async () => {
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        return createTestSceneSnapshot(sessionId, sceneId, {
          renders: [createTestRender(sceneId, 'render_1', { status: reads === 1 ? 'queued' : 'completed' })],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)

    // The recovery read already saw the render as queued, so the loop started on its own.
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).renderRefresh.status).toBe('active')
    expect(harness.scheduler.pendingCount()).toBe(1)

    await harness.scheduler.fire()

    // One additional authoritative read of exactly this Scene, and nothing to wait for afterwards.
    expect(harness.calls.getSceneSnapshot).toEqual([CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_A])
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.renderRefresh.status).toBe('idle')
    // One read happened, but the wait is over: the counter resets, which is exactly what gives the
    // next render of this Scene a full budget instead of inheriting this one's.
    expect(record.renderRefresh.refreshes).toBe(0)
    expect(record.renderRefresh.consecutiveFailures).toBe(0)
    expect(harness.scheduler.pendingCount()).toBe(0)
    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'after the render finished'))
    await flush()
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).renderRefresh.status).toBe('idle')
    expect(harness.scheduler.pendingCount()).toBe(0)
  })

  it('watches only the selected Scene and cancels the loop on a switch, detach and dispose', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    const streamA = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    streamA.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_a', { status: 'running' }),
      }),
    )
    await flush()
    expect(harness.scheduler.pendingCount()).toBe(1)

    harness.controller.selectScene(CINEMA_TEST_SCENE_B)
    await flush()
    // The tick of A is cancelled; B has nothing unfinished, so it schedules nothing.
    expect(harness.scheduler.pendingCount()).toBe(0)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_B).renderRefresh.status).toBe('idle')

    const streamB = lastSubscription(harness)
    streamB.emitStatus({ state: 'connected', attempt: 1 })
    streamB.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_B, 'render_b', { status: 'queued' }),
      }),
    )
    await flush()
    expect(harness.scheduler.pendingCount()).toBe(1)

    harness.controller.detach()
    expect(harness.scheduler.pendingCount()).toBe(0)

    harness.controller.attach()
    harness.controller.resumeSelectedScene()
    // 11C7-B1: `detach()` replaced the subscription, so the connection must be reported on the fresh
    // one. Emitting it on the pre-detach object describes a transport nobody is bound to.
    const freshB = lastSubscription(harness)
    freshB.emitStatus({ state: 'connected', attempt: 2 })
    await flush()
    expect(harness.scheduler.pendingCount()).toBe(1)

    harness.controller.dispose()
    expect(harness.scheduler.pendingCount()).toBe(0)
  })

  it('backs off a failing refresh, pauses the loop and resumes only on demand', async () => {
    const harness = createHarness({
      getSceneSnapshot: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'queued' }),
      }),
    )
    await flush()

    const delays: number[] = []
    for (let attempt = 0; attempt < STUDIO_CINEMA_RENDER_REFRESH_MAX_CONSECUTIVE_FAILURES; attempt += 1) {
      const pending = harness.scheduler.pending[0]
      expect(pending).toBeDefined()
      delays.push(pending?.delayMs ?? 0)
      await harness.scheduler.fire()
    }

    // Exponential and capped: 3s, 6s, 12s, 24s, then the cap.
    expect(delays).toEqual([
      STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS,
      STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS * 2,
      STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS * 4,
      STUDIO_CINEMA_RENDER_REFRESH_INTERVAL_MS * 8,
      STUDIO_CINEMA_RENDER_REFRESH_BACKOFF_MAX_MS,
    ])

    const paused = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    // The render keeps its real status; only the loop stopped, and it says why.
    expect(paused.renderRefresh.status).toBe('paused')
    expect(paused.renderRefresh.pauseReason).toBe('failures')
    expect(paused.renderRefresh.consecutiveFailures).toBe(
      STUDIO_CINEMA_RENDER_REFRESH_MAX_CONSECUTIVE_FAILURES,
    )
    expect(paused.renders[0]?.status).toBe('queued')
    expect(harness.scheduler.pendingCount()).toBe(0)

    // A tick fired while paused would be a silent poll; there is none to fire.
    expect(harness.scheduler.pending).toHaveLength(0)

    expect(harness.controller.resumeSceneRenderRefresh(CINEMA_TEST_SCENE_A)).toBe(true)
    const resumed = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(resumed.renderRefresh.status).toBe('active')
    expect(resumed.renderRefresh.refreshes).toBe(0)
    expect(resumed.renderRefresh.consecutiveFailures).toBe(0)
    expect(harness.scheduler.pendingCount()).toBe(1)

    // Resuming a Scene that is not paused is a no-op, not a restart.
    expect(harness.controller.resumeSceneRenderRefresh(CINEMA_TEST_SCENE_A)).toBe(false)
  })

  it('pauses at the refresh budget instead of polling a render forever', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'running' }),
      }),
    )
    await flush()

    // The default snapshot keeps the render unfinished (renders are merged, never dropped).
    for (let index = 0; index < STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT; index += 1) {
      await harness.scheduler.fire()
    }

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.renderRefresh.refreshes).toBe(STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT)
    expect(record.renderRefresh.status).toBe('paused')
    expect(record.renderRefresh.pauseReason).toBe('budget')
    expect(harness.scheduler.pendingCount()).toBe(0)
    expect(harness.calls.getSceneSnapshot).toHaveLength(1 + STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT)

    // The manual recovery grants a fresh budget.
    expect(harness.controller.resumeSceneRenderRefresh(CINEMA_TEST_SCENE_A)).toBe(true)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).renderRefresh.pauseReason).toBeNull()
    expect(harness.scheduler.pendingCount()).toBe(1)
  })

  it('joins a read already in flight instead of starting a revision war', async () => {
    const recovery = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 1) {
          return recovery.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId)
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])

    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    const stream = lastSubscription(harness)
    // Before any connection the frame is live, so the loop is watching the unfinished render.
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'queued' }),
      }),
    )
    await flush()
    expect(harness.scheduler.pendingCount()).toBe(1)

    stream.emitStatus({ state: 'connected', attempt: 0 })
    await flush()
    // The recovery read of this Scene is genuinely in flight.
    expect(harness.calls.getSceneSnapshot).toHaveLength(1)

    const reconcile = harness.controller.reconcileScene(CINEMA_TEST_SCENE_A)
    await harness.scheduler.fire()

    // The refresh tick and the manual reconcile both joined the read that was already running.
    expect(harness.calls.getSceneSnapshot).toHaveLength(1)

    recovery.resolve(createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A))
    await flush()

    await expect(reconcile).resolves.toBe('ok')
    expect(harness.calls.getSceneSnapshot).toHaveLength(1)
    // One read served three callers, and the loop is still alive because the render is unfinished.
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.renderRefresh.refreshes).toBe(1)
    expect(record.renderRefresh.status).toBe('active')
    expect(harness.scheduler.pendingCount()).toBe(1)
  })

  it('keeps one running tick while a read hangs and never counts a joined read twice', async () => {
    const hung = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 2) {
          return hung.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId, {
          renders: [createTestRender(sceneId, 'render_1', { status: 'queued' })],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).renderRefresh.status).toBe('active')
    expect(harness.scheduler.pendingCount()).toBe(1)

    await harness.scheduler.fire()
    await flush()
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)

    // Three scheduling pressures while the tick is in flight: a live event, another render frame and a
    // manual reconciliation. None may start a second tick, because the cycle's single slot is taken.
    stream.emit(createTestTextFrame(CINEMA_TEST_SCENE_A, 'live while the tick hangs'))
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'running' }),
      }),
    )
    void harness.controller.reconcileScene(CINEMA_TEST_SCENE_A)
    await flush()
    expect(harness.scheduler.pendingCount()).toBe(0)
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)

    hung.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        renders: [createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'queued' })],
      }),
    )
    await flush()

    // One read served the tick and the manual reconcile: one outcome, one count, one new tick.
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.renderRefresh.refreshes).toBe(1)
    expect(record.renderRefresh.consecutiveFailures).toBe(0)
    expect(record.renderRefresh.status).toBe('active')
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)
    expect(harness.scheduler.pendingCount()).toBe(1)
  })

  it('gives a second render a fresh budget instead of inheriting the paused one', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'running' }),
      }),
    )
    await flush()

    for (let index = 0; index < STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT; index += 1) {
      await harness.scheduler.fire()
    }
    const paused = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(paused.renderRefresh.status).toBe('paused')
    expect(paused.renderRefresh.pauseReason).toBe('budget')
    expect(paused.renderRefresh.refreshes).toBe(STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT)
    expect(harness.scheduler.pendingCount()).toBe(0)

    // The first render finishes and a second one is queued. That is a different wait, so the pause of
    // the finished one does not bind it: full budget, no pause, a tick already pending.
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'completed' }),
      }),
    )
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_2', { status: 'queued' }),
      }),
    )
    await flush()

    const fresh = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(fresh.renderRefresh.status).toBe('active')
    expect(fresh.renderRefresh.pauseReason).toBeNull()
    expect(fresh.renderRefresh.refreshes).toBe(0)
    expect(harness.scheduler.pendingCount()).toBe(1)

    await harness.scheduler.fire()
    const counted = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(counted.renderRefresh.refreshes).toBe(1)
    expect(counted.renderRefresh.status).toBe('active')
    expect(counted.renderRefresh.pauseReason).toBeNull()
  })

  it('keeps a paused wait paused across a detach and attach of the same wait', async () => {
    const harness = createHarness()
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    stream.emit(
      createTestFrame('render.updated', {
        sessionId: CINEMA_TEST_SESSION_ID,
        render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'running' }),
      }),
    )
    await flush()
    for (let index = 0; index < STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT; index += 1) {
      await harness.scheduler.fire()
    }
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).renderRefresh.pauseReason).toBe('budget')

    // A remount is not a new wait: the counter and the pause survive it, so re-mounting cannot be
    // used to poll a render forever.
    harness.controller.detach()
    harness.controller.attach()
    harness.controller.resumeSelectedScene()
    lastSubscription(harness).emitStatus({ state: 'connected', attempt: 1 })
    await flush()

    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.renderRefresh.status).toBe('paused')
    expect(record.renderRefresh.pauseReason).toBe('budget')
    expect(record.renderRefresh.refreshes).toBe(STUDIO_CINEMA_RENDER_REFRESH_MAX_COUNT)
    expect(harness.scheduler.pendingCount()).toBe(0)

    // Only the explicit resume re-arms it.
    expect(harness.controller.resumeSceneRenderRefresh(CINEMA_TEST_SCENE_A)).toBe(true)
    expect(harness.scheduler.pendingCount()).toBe(1)
  })

  it('drops the response of a cycle that a revisit of the same scene replaced', async () => {
    const first = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 2) {
          return first.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId, {
          renders: [createTestRender(sceneId, 'render_1', { status: 'queued' })],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    expect(harness.scheduler.pendingCount()).toBe(1)

    await harness.scheduler.fire()
    await flush()
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)

    // Away and back: same Scene, different visit, therefore a different cycle.
    harness.controller.selectScene(CINEMA_TEST_SCENE_B)
    await flush()
    harness.controller.selectScene(CINEMA_TEST_SCENE_A)
    await flush()

    const revisited = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(revisited.renderRefresh.status).toBe('active')
    expect(revisited.renderRefresh.refreshes).toBe(0)
    expect(harness.scheduler.pendingCount()).toBe(1)

    // The first visit's response lands now: it belongs to the replaced cycle and counts for nothing.
    first.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        renders: [createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'queued' })],
      }),
    )
    await flush()
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).renderRefresh.refreshes).toBe(0)

    // The new cycle's own tick still works.
    await harness.scheduler.fire()
    expect(sceneRecord(harness, CINEMA_TEST_SCENE_A).renderRefresh.refreshes).toBe(1)
  })

  it('never counts a superseded read as a refresh or as a failure', async () => {
    const hung = createDeferred<StudioSceneSnapshot>()
    let reads = 0
    const harness = createHarness({
      getSceneSnapshot: async (sessionId, sceneId) => {
        reads += 1
        if (reads === 2) {
          return hung.promise
        }
        return createTestSceneSnapshot(sessionId, sceneId, {
          renders: [createTestRender(sceneId, 'render_1', { status: 'queued' })],
        })
      },
    })
    await seedScenes(harness, [CINEMA_TEST_SCENE_A])
    const stream = await selectSceneAndConnect(harness, CINEMA_TEST_SCENE_A)
    await harness.scheduler.fire()
    await flush()
    expect(harness.calls.getSceneSnapshot).toHaveLength(2)

    // 11C7-B2: a newer authoritative read needs a real reconnect. `disconnected` closes the stream
    // epoch and the next `connected` opens the recovery window whose read owns a newer revision;
    // a bare first `connected` starts no read, so it could never supersede the in-flight tick.
    stream.emitStatus({ state: 'disconnected', attempt: 1 })
    await flush()
    stream.emitStatus({ state: 'connected', attempt: 2 })
    await flush()
    hung.resolve(
      createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        renders: [createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'queued' })],
      }),
    )
    await flush()

    // Superseded is neither a success nor a failure: no counter moved and the loop is still alive.
    const record = sceneRecord(harness, CINEMA_TEST_SCENE_A)
    expect(record.renderRefresh.refreshes).toBe(0)
    expect(record.renderRefresh.consecutiveFailures).toBe(0)
    expect(record.renderRefresh.status).toBe('active')
    expect(harness.scheduler.pendingCount()).toBe(1)
  })
})

describe('scene snapshot read ownership', () => {
  const identity: StudioCinemaSceneIdentity = {
    sessionId: CINEMA_TEST_SESSION_ID,
    sceneId: CINEMA_TEST_SCENE_A,
  }
  const facts: StudioCinemaSnapshotOwnershipFacts = {
    inactive: false,
    generation: 2,
    sessionId: CINEMA_TEST_SESSION_ID,
    revision: 5,
    stream: { subscriptionId: 3, epoch: 2, connected: true },
    recoveryWindow: { subscriptionId: 3, epoch: 2 },
  }
  const streamRecovery: StudioCinemaSnapshotOwnership = {
    kind: 'stream-recovery',
    generation: 2,
    identity,
    revision: 5,
    subscriptionId: 3,
    epoch: 2,
  }
  const manualReconcile: StudioCinemaSnapshotOwnership = {
    kind: 'manual-reconcile',
    generation: 2,
    identity,
    revision: 5,
  }
  const convergence: StudioCinemaSnapshotOwnership = {
    kind: 'convergence',
    generation: 2,
    identity,
    revision: 5,
  }

  it('accepts a stream recovery only while its subscription, epoch and connection hold', () => {
    expect(readStudioCinemaSnapshotOwnershipVerdict(streamRecovery, facts)).toBe('valid')
    expect(
      readStudioCinemaSnapshotOwnershipVerdict(streamRecovery, {
        ...facts,
        stream: { subscriptionId: 3, epoch: 2, connected: false },
      }),
    ).toBe('superseded')
    expect(
      readStudioCinemaSnapshotOwnershipVerdict(streamRecovery, {
        ...facts,
        stream: { subscriptionId: 4, epoch: 1, connected: true },
      }),
    ).toBe('superseded')
    expect(
      readStudioCinemaSnapshotOwnershipVerdict(streamRecovery, {
        ...facts,
        stream: { subscriptionId: 3, epoch: 3, connected: true },
      }),
    ).toBe('superseded')
    expect(readStudioCinemaSnapshotOwnershipVerdict(streamRecovery, { ...facts, stream: null })).toBe(
      'superseded',
    )
    expect(
      readStudioCinemaSnapshotOwnershipVerdict(streamRecovery, { ...facts, recoveryWindow: null }),
    ).toBe('superseded')
    expect(
      readStudioCinemaSnapshotOwnershipVerdict(streamRecovery, {
        ...facts,
        recoveryWindow: { subscriptionId: 3, epoch: 1 },
      }),
    ).toBe('superseded')
  })

  it('calls every read stale once the binding, the generation or the Session moved on', () => {
    for (const ownership of [streamRecovery, manualReconcile, convergence]) {
      expect(readStudioCinemaSnapshotOwnershipVerdict(ownership, { ...facts, inactive: true })).toBe('stale')
      expect(readStudioCinemaSnapshotOwnershipVerdict(ownership, { ...facts, generation: 3 })).toBe('stale')
      expect(readStudioCinemaSnapshotOwnershipVerdict(ownership, { ...facts, sessionId: 'session_other' })).toBe(
        'stale',
      )
    }
  })

  it('supersedes a read of an older revision for every kind', () => {
    for (const ownership of [streamRecovery, manualReconcile, convergence]) {
      expect(readStudioCinemaSnapshotOwnershipVerdict(ownership, { ...facts, revision: 6 })).toBe('superseded')
    }
  })

  it('accepts manual and convergence reads without a stream of their own', () => {
    const detachedFacts = { ...facts, stream: null, recoveryWindow: null }
    expect(readStudioCinemaSnapshotOwnershipVerdict(manualReconcile, detachedFacts)).toBe('valid')
    expect(readStudioCinemaSnapshotOwnershipVerdict(convergence, detachedFacts)).toBe('valid')
  })
})
