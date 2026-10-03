import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../i18n'
import type { StudioEventSubscriptionOptions } from '../../api/studio-agent-events'
import type { StudioSession, StudioSessionSnapshot } from '../../protocol/studio-agent-types'
import type { StudioCinemaControllerDependencies } from '../cinema-controller'
import type { StudioCinemaSessionGatewayDependencies } from '../session/studio-cinema-session-gateway'
import {
  createTestRender,
  createTestRun,
  createTestScene,
  createTestSceneSnapshot,
  CINEMA_TEST_SCENE_A,
  CINEMA_TEST_SCENE_B,
  CINEMA_TEST_SCENE_C,
  CINEMA_TEST_SESSION_ID,
} from '../cinema-fixtures'
import { ManimCinemaWorkspace } from './ManimCinemaWorkspace'
import type { StudioCinemaSceneSelectionStore } from './scene-selection-plan'

/**
 * Cinema workspace specs (task 11C2, sections 4 to 8).
 *
 * The workspace is rendered with a fake Session gateway, a fake controller API and a capturing event
 * source: no fetch, no socket, no real timer. The copy asserted below is the English one, because the
 * i18n provider defaults to `en-US` in a fresh jsdom document.
 */

interface FakeSubscription {
  options: StudioEventSubscriptionOptions
  emitStatus: (status: { state: string; attempt: number }) => void
  isAborted: () => boolean
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** In-memory Scene-selection store: proves the workspace never touches global storage. */
export interface TestSceneSelectionStore extends StudioCinemaSceneSelectionStore {
  entries: Map<string, string>
  writes: Array<{ sessionId: string; sceneId: string | null }>
}

export function createTestSceneSelectionStore(seed?: Record<string, string>): TestSceneSelectionStore {
  const entries = new Map<string, string>(Object.entries(seed ?? {}))
  const writes: Array<{ sessionId: string; sceneId: string | null }> = []
  return {
    entries,
    writes,
    read: (_studioKind, sessionId) => entries.get(sessionId) ?? null,
    write: (_studioKind, sessionId, sceneId) => {
      writes.push({ sessionId, sceneId })
      if (sceneId === null) {
        entries.delete(sessionId)
        return
      }
      entries.set(sessionId, sceneId)
    },
  }
}

interface WorkspaceHarness {
  sessionDeps: Partial<StudioCinemaSessionGatewayDependencies>
  controllerDeps: Partial<StudioCinemaControllerDependencies>
  calls: {
    createScene: string[]
    createSceneRun: Array<{ sessionId: string; sceneId: string }>
    cancelRun: string[]
    getSceneSnapshot: Array<{ sessionId: string; sceneId: string }>
    /** Every Session the fake API was asked to create, in call order. */
    createSession: string[]
  }
  subscriptions: FakeSubscription[]
  scheduler: { pendingCount: () => number; fire: () => Promise<void> }
  storage: Map<string, string>
  forgotten: string[]
  selectionStore: TestSceneSelectionStore
  /** Unresolved Session reads of the gateway, in arrival order (only while deferring). */
  gatewayReads: Array<Deferred<StudioSessionSnapshot>>
  /** Unresolved Session reads of the controller (the Scene index), in arrival order. */
  indexReads: Array<Deferred<StudioSessionSnapshot>>
  /** Unresolved Session creations, in arrival order (only while deferring). */
  createReads: Array<Deferred<StudioSession>>
  /** Bounded counters: how many Session reads each layer issued, and how often storage was read. */
  sessionReadCounts: { gateway: number; controller: number; storage: number }
  buildSessionSnapshot: (sessionId: string) => StudioSessionSnapshot
}

const ISO = '2026-03-22T00:00:00.000Z'

function createHarness(options?: {
  history?: string[]
  indexScenes?: string[]
  sceneIdsBySession?: Record<string, string[]>
  selection?: Record<string, string>
  createSessionFails?: unknown
  /** Defer gateway Session reads from this 0-based read onward (infinity = never defer). */
  deferGatewayReadsFrom?: number
  /** Defer the controller's Session read (the Scene index) when true. */
  deferIndexRead?: boolean
  /** Defer the create request when true. */
  deferCreateSession?: boolean
  sceneSnapshots?: Record<string, () => Promise<ReturnType<typeof createTestSceneSnapshot>>>
}): WorkspaceHarness {
  const history = options?.history ?? []
  const storage = new Map<string, string>()
  const forgotten: string[] = []
  const createSceneCalls: string[] = []
  const createSceneRunCalls: Array<{ sessionId: string; sceneId: string }> = []
  const cancelRunCalls: string[] = []
  const sceneSnapshotCalls: Array<{ sessionId: string; sceneId: string }> = []
  const createSessionCalls: string[] = []
  const subscriptions: FakeSubscription[] = []
  const timers: Array<{ task: () => void; cancelled: boolean }> = []
  const gatewayReads: Array<Deferred<StudioSessionSnapshot>> = []
  const indexReads: Array<Deferred<StudioSessionSnapshot>> = []
  const createReads: Array<Deferred<StudioSession>> = []
  const selectionStore = createTestSceneSelectionStore(options?.selection)
  const defaultSceneIds = options?.indexScenes ?? [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B, CINEMA_TEST_SCENE_C]

  const buildSessionSnapshot = (sessionId: string) => {
    const sceneIds = options?.sceneIdsBySession?.[sessionId] ?? defaultSceneIds
    return {
      session: {
        id: sessionId,
        projectId: 'manimcat-studio',
        studioKind: 'manim' as const,
        agentType: 'builder' as const,
        title: 'Manim Studio',
        directory: '/workspace/session',
        createdAt: ISO,
        updatedAt: ISO,
      },
      messages: [],
      runs: [],
      renders: [],
      scenes: sceneIds.map((sceneId, position) => createTestScene(sessionId, sceneId, position)),
    }
  }

  let gatewayReadCount = 0
  const sessionReadCounts = { gateway: 0, controller: 0, storage: 0 }
  const deferGatewayReadsFrom = options?.deferGatewayReadsFrom ?? Number.POSITIVE_INFINITY

  const sessionDeps: Partial<StudioCinemaSessionGatewayDependencies> = {
    api: {
      createSession: (input) => {
        if (options?.createSessionFails) {
          return Promise.reject(options.createSessionFails)
        }
        const session: StudioSession = {
          id: `session_created_${String(createReads.length + 1)}`,
          projectId: input.projectId,
          studioKind: 'manim',
          agentType: 'builder',
          title: input.title ?? 'Manim Studio',
          directory: '/workspace/session',
          createdAt: ISO,
          updatedAt: ISO,
        }
        if (options?.deferCreateSession) {
          const control = defer<StudioSession>()
          createReads.push(control)
          createSessionCalls.push(session.id)
          return control.promise
        }
        createSessionCalls.push(session.id)
        return Promise.resolve(session)
      },
      getSessionSnapshot: (sessionId) => {
        sessionReadCounts.gateway += 1
        const readIndex = gatewayReadCount
        gatewayReadCount += 1
        if (readIndex >= deferGatewayReadsFrom) {
          const control = defer<StudioSessionSnapshot>()
          gatewayReads.push(control)
          return control.promise
        }
        return Promise.resolve(buildSessionSnapshot(sessionId))
      },
    },
    storage: {
      readLastSessionId: () => history[0] ?? null,
      readRecentSessionIds: () => {
        sessionReadCounts.storage += 1
        return [...history]
      },
      rememberSessionId: (_studioKind, sessionId) => {
        storage.set('last', sessionId)
      },
      forgetSessionId: (_studioKind, sessionId) => {
        forgotten.push(sessionId)
        const index = history.indexOf(sessionId)
        if (index >= 0) {
          history.splice(index, 1)
        }
      },
    },
  }

  const controllerDeps: Partial<StudioCinemaControllerDependencies> = {
    api: {
      createScene: (sessionId) => {
        createSceneCalls.push(sessionId)
        return Promise.resolve(
          createTestScene(sessionId, `scene_${String(createSceneCalls.length).padStart(4, '0')}`, createSceneCalls.length - 1),
        )
      },
      reorderScenes: async (_sessionId, sceneIdsToReorder) =>
        sceneIdsToReorder.map((sceneId, position) => createTestScene(CINEMA_TEST_SESSION_ID, sceneId, position)),
      getSessionSnapshot: (sessionId) => {
        sessionReadCounts.controller += 1
        if (options?.deferIndexRead) {
          const control = defer<StudioSessionSnapshot>()
          indexReads.push(control)
          return control.promise
        }
        return Promise.resolve(buildSessionSnapshot(sessionId))
      },
      getSceneSnapshot: (sessionId, sceneId) => {
        sceneSnapshotCalls.push({ sessionId, sceneId })
        const respond = options?.sceneSnapshots?.[sceneId]
        if (respond) {
          return respond()
        }
        return Promise.resolve(createTestSceneSnapshot(sessionId, sceneId))
      },
      createSceneRun: (sessionId, sceneId) => {
        createSceneRunCalls.push({ sessionId, sceneId })
        const run = createTestRun(sceneId, `run_${createSceneRunCalls.length}`, 'running')
        return Promise.resolve({
          scene: createTestScene(sessionId, sceneId, 0),
          messages: [],
          runs: [run],
          renders: [],
          run,
        })
      },
      cancelRun: (runId) => {
        cancelRunCalls.push(runId)
        return Promise.resolve({ status: 'cancelled' })
      },
    },
    provider: {
      resolve: () => ({
        customApiConfig: { apiUrl: 'http://provider.invalid', apiKey: 'key', model: 'model' },
        hasIncompleteProvider: false,
      }),
    },
    events: {
      subscribe: (subscriptionOptions) => {
        subscriptions.push({
          options: subscriptionOptions,
          emitStatus: (status) => subscriptionOptions.onStatusChange?.(status as never),
          isAborted: () => subscriptionOptions.signal.aborted,
        })
        // A real transport reports the connection it established; the controller only reads a Scene
        // snapshot after that, so the fake does the same.
        subscriptionOptions.onStatusChange?.({ state: 'connected', attempt: 0 } as never)
        return Promise.resolve()
      },
    },
    clock: { now: () => Date.parse(ISO) },
    createAbortController: () => new AbortController(),
    createWorkflowId: () => 'workflow_1',
    scheduler: {
      schedule: (_delayMs, task) => {
        const entry = { task, cancelled: false }
        timers.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    },
  }

  return {
    sessionDeps,
    controllerDeps,
    calls: {
      createScene: createSceneCalls,
      createSceneRun: createSceneRunCalls,
      cancelRun: cancelRunCalls,
      getSceneSnapshot: sceneSnapshotCalls,
      createSession: createSessionCalls,
    },
    subscriptions,
    storage,
    forgotten,
    selectionStore,
    gatewayReads,
    indexReads,
    createReads,
    sessionReadCounts,
    buildSessionSnapshot,
    scheduler: {
      pendingCount: () => timers.filter((entry) => !entry.cancelled).length,
      fire: async () => {
        const entry = timers.find((candidate) => !candidate.cancelled)
        if (!entry) {
          return
        }
        entry.cancelled = true
        entry.task()
        await act(async () => {
          await Promise.resolve()
        })
      },
    },
  }
}

async function renderWorkspace(
  harness: WorkspaceHarness,
  options?: { strict?: boolean; onExit?: () => void },
): Promise<void> {
  const wrapper = options?.strict
    ? ({ children }: { children: ReactNode }) => (
        <StrictMode>
          <I18nProvider>{children}</I18nProvider>
        </StrictMode>
      )
    : ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>

  await act(async () => {
    render(
      <ManimCinemaWorkspace
        onExit={options?.onExit ?? (() => undefined)}
        sessionOverrides={harness.sessionDeps}
        controllerOverrides={harness.controllerDeps}
        sceneSelectionStore={harness.selectionStore}
      />,
      { wrapper },
    )
    await Promise.resolve()
  })
}

function userMessage(sceneId: string, text: string) {
  return {
    id: `message_${sceneId}`,
    sessionId: CINEMA_TEST_SESSION_ID,
    sceneId,
    role: 'user' as const,
    text,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

const SESSION_A = 'session_a'
const SESSION_B = 'session_b'

/** The scrolling list of the open history panel. */
function historyList(): HTMLDivElement {
  const dialog = screen.getByRole('dialog')
  const list = dialog.querySelector('.overflow-y-auto')
  if (!(list instanceof HTMLDivElement)) {
    throw new Error('history list not found')
  }
  return list
}

/**
 * jsdom has no layout, so the scroll geometry of every element is stubbed for the scroll specs: a
 * growable content height and a fixed viewport height. `scrollTop` stays a normal property.
 */
function installScrollGeometry(): { setScrollHeight: (value: number) => void; restore: () => void } {
  const box = { scrollHeight: 1000, clientHeight: 200 }
  const original = {
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => box.scrollHeight,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => box.clientHeight,
  })
  return {
    setScrollHeight: (value) => {
      box.scrollHeight = value
    },
    restore: () => {
      if (original.scrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original.scrollHeight)
      }
      if (original.clientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', original.clientHeight)
      }
    },
  }
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText('Tell the cat what you want…') as HTMLTextAreaElement
}

function catButton(): HTMLButtonElement {
  return screen.getByLabelText('Cat: open or close this Scene conversation') as HTMLButtonElement
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('cinema workspace', () => {
  // Expected RED until the 11C6 production fix: `initializeScenes()` registers its workflow slot only
  // after the workflow body has already checked liveness, so a fresh Session is never filled. Evidence:
  // task11c5-logs/diag-init2.log (1 createSession, 0 createScene, no tabs) and the controller repros.
  it('creates the three default scenes exactly once for a new session', async () => {
    const harness = createHarness({ indexScenes: [] })
    await renderWorkspace(harness, { strict: true })
    await flush()

    // Correction 11C5-§4: the created Session is the one the app just made, and the empty index is what
    // forces real creation. The old expectation hard-coded a restored Session id, which the harness
    // never returns from createSession.
    const createdSessionId = harness.calls.createSession[0]
    expect(harness.calls.createSession).toHaveLength(1)
    expect(harness.calls.createScene).toEqual([createdSessionId, createdSessionId, createdSessionId])
    expect(screen.getByRole('tab', { name: /Scene 1/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Scene 2/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Scene 3/ })).toBeInTheDocument()
  })

  // Correction 11C5-§4: an empty index must produce exactly three createScene calls, one per Scene, in a
  // stable order and without duplicates. The Scene snapshot never back-fills them. Expected RED until 11C6.
  it('fills a genuinely empty index with exactly three Scenes, one append at a time', async () => {
    const harness = createHarness({ indexScenes: [] })
    await renderWorkspace(harness)
    await flush()

    const createdSessionId = harness.calls.createSession[0]
    expect(new Set(harness.calls.createScene)).toEqual(new Set([createdSessionId]))
    expect(harness.calls.createScene).toHaveLength(3)
    // The tab renders its label and its status chip as adjacent elements, so `textContent` has no
    // separator between them (and must not be pinned to one exact concatenation).
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    tabs.forEach((tab, index) => {
      expect(tab).toHaveTextContent(`Scene ${index + 1}`)
      expect(tab).toHaveTextContent('Ready')
    })
  })

  // Correction 11C5-§4: the same rule for a restored Session — an index that already carries three
  // Scenes must not be filled again, so createScene stays empty and the read is the only server call.
  it('never fills a restored index that already carries three Scenes', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    expect(harness.calls.createSession).toEqual([])
    expect(harness.calls.createScene).toEqual([])
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('never back-fills a restored session', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    expect(harness.calls.createScene).toEqual([])
    // Correction R1: a restored Session with no stored choice opens its first Scene, and the read
    // proves the workspace uses the existing Scene instead of creating one.
    expect(screen.getByRole('tab', { name: /Scene 1/ })).toHaveAttribute('aria-selected', 'true')
    expect(harness.calls.getSceneSnapshot).toEqual([
      { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A },
    ])
    expect(harness.selectionStore.entries.get(CINEMA_TEST_SESSION_ID)).toBe(CINEMA_TEST_SCENE_A)
  })

  it('keeps the session list and offers a reconnect when the server cannot answer', async () => {
    const harness = createHarness({ history: ['session_kept'] })
    harness.sessionDeps = {
      ...harness.sessionDeps,
      api: {
        createSession: () => Promise.reject(new Error('must not create')),
        getSessionSnapshot: () => Promise.reject(new TypeError('Failed to fetch')),
      },
    }

    await renderWorkspace(harness)
    await flush()

    expect(screen.getByText('Session 1')).toBeInTheDocument()
    expect(screen.getByText('The server is unreachable; the session list is kept.')).toBeInTheDocument()
    expect(screen.getByText('Reconnect')).toBeInTheDocument()
  })

  it('collapses and expands the session sidebar without hiding the composer', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    fireEvent.click(screen.getByLabelText('Collapse session list'))
    expect(screen.queryByText('New session')).toBeNull()
    expect(composer()).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Expand session list'))
    expect(screen.getByText('New session')).toBeInTheDocument()
  })

  it('keeps the history hidden while the composer stays visible and sendable', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    expect(screen.queryByRole('dialog')).toBeNull()
    const send = screen.getByLabelText('Send')
    expect(composer()).toBeInTheDocument()

    fireEvent.change(composer(), { target: { value: 'draw a circle' } })
    await flush()
    expect(send).toBeEnabled()
  })

  it('opens and closes the conversation only through the cat', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    fireEvent.click(catButton())
    await flush()
    const dialog = screen.getByRole('dialog')
    expect(catButton()).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByText('No conversation yet. Try: draw a circle.')).toBeInTheDocument()

    fireEvent.click(catButton())
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(catButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('never opens the history because of a send, a completion or a failure', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    fireEvent.change(composer(), { target: { value: 'draw a circle' } })
    await flush()
    fireEvent.click(screen.getByLabelText('Send'))
    await flush()

    expect(harness.calls.createSceneRun).toEqual([{ sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A }])
    expect(screen.queryByRole('dialog')).toBeNull()

    // A streamed completion and a failed tool arrive on the selected Scene's stream.
    const subscription = harness.subscriptions[0]
    expect(subscription).toBeDefined()
    await act(async () => {
      subscription?.options.onEvent({
        type: 'run.updated',
        properties: {
          sessionId: CINEMA_TEST_SESSION_ID,
          sceneId: CINEMA_TEST_SCENE_A,
          run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'completed'),
        },
      } as never)
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closing the history keeps the draft and never cancels the running task', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    fireEvent.change(composer(), { target: { value: 'keep me' } })
    await flush()
    fireEvent.click(catButton())
    await flush()
    fireEvent.click(screen.getByLabelText('Hide'))
    await flush()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(composer().value).toBe('keep me')
    expect(harness.calls.cancelRun).toEqual([])
  })

  it('returns focus to the cat when the history is closed with Escape', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    fireEvent.click(catButton())
    await flush()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(catButton())
  })

  it('keeps drafts and messages apart per scene', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      sceneSnapshots: {
        [CINEMA_TEST_SCENE_A]: () =>
          Promise.resolve(
            createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
              messages: [userMessage(CINEMA_TEST_SCENE_A, 'only in scene one')],
            }),
          ),
        [CINEMA_TEST_SCENE_B]: () =>
          Promise.resolve(
            createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B, {
              messages: [userMessage(CINEMA_TEST_SCENE_B, 'only in scene two')],
            }),
          ),
      },
    })
    await renderWorkspace(harness)
    await flush()

    fireEvent.change(composer(), { target: { value: 'scene one draft' } })
    await flush()

    fireEvent.click(catButton())
    await flush()
    expect(screen.getByText('only in scene one')).toBeInTheDocument()
    expect(screen.queryByText('only in scene two')).toBeNull()
    fireEvent.click(screen.getByLabelText('Hide'))
    await flush()

    fireEvent.click(screen.getByRole('tab', { name: /Scene 2/ }))
    await flush()
    expect(composer().value).toBe('')

    fireEvent.click(catButton())
    await flush()
    expect(screen.getByText('only in scene two')).toBeInTheDocument()
    expect(screen.queryByText('only in scene one')).toBeNull()
    fireEvent.click(screen.getByLabelText('Hide'))
    await flush()

    fireEvent.change(composer(), { target: { value: 'scene two draft' } })
    await flush()

    fireEvent.click(screen.getByRole('tab', { name: /Scene 1/ }))
    await flush()
    expect(composer().value).toBe('scene one draft')
  })

  it('lets another scene keep working while one scene runs', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      sceneSnapshots: {
        [CINEMA_TEST_SCENE_A]: () =>
          Promise.resolve(
            createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
              runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_running', 'running')],
            }),
          ),
      },
    })
    await renderWorkspace(harness)
    await flush()

    expect(screen.getByLabelText('Send')).toBeDisabled()
    expect(screen.getByText('This Scene already has a running task; stop it first.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Scene 2/ }))
    await flush()
    fireEvent.change(composer(), { target: { value: 'another idea' } })
    await flush()
    expect(screen.getByLabelText('Send')).toBeEnabled()
  })

  // Fixture correction 11C5-H3: the folded body is rendered from `output`, so a fixture that reuses the
  // row title as the body text makes the query ambiguous by construction. The result body is distinct
  // here and is still required to appear, and the internal error is still required to be absent.
  it('folds a tool activity and never renders an internal error', async () => {
    const internalError = 'Traceback: /srv/private/scene.py secret-token'
    const foldedResult = 'Diagnostic: line 3 uses an unknown name.'
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      sceneSnapshots: {
        [CINEMA_TEST_SCENE_A]: () =>
          Promise.resolve(
            createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
              messages: [
                {
                  id: 'message_1',
                  sessionId: CINEMA_TEST_SESSION_ID,
                  sceneId: CINEMA_TEST_SCENE_A,
                  role: 'assistant',
                  agent: 'builder',
                  createdAt: ISO,
                  updatedAt: ISO,
                  parts: [
                    {
                      id: 'part_tool',
                      messageId: 'message_1',
                      sessionId: CINEMA_TEST_SESSION_ID,
                      type: 'tool',
                      tool: 'static-check',
                      callId: 'call_1',
                      state: {
                        status: 'error',
                        title: 'Static check completed: 1 diagnostic.',
                        output: foldedResult,
                      },
                    },
                  ],
                },
              ],
            }),
          ),
      },
    })
    await renderWorkspace(harness)
    await flush()

    fireEvent.click(catButton())
    await flush()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('static-check')).toBeInTheDocument()
    expect(within(dialog).getByText('Failed')).toBeInTheDocument()
    expect(within(dialog).queryByText(internalError)).toBeNull()

    fireEvent.click(within(dialog).getByText('Show result'))
    await flush()
    expect(within(dialog).getByText(foldedResult)).toBeInTheDocument()
  })

  it('offers a manual resume when automatic checking paused', async () => {
    let reads = 0
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      sceneSnapshots: {
        [CINEMA_TEST_SCENE_A]: () => {
          reads += 1
          if (reads === 1) {
            return Promise.resolve(
              createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
                renders: [createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'queued' })],
              }),
            )
          }
          return Promise.reject(new TypeError('Failed to fetch'))
        },
      },
    })
    await renderWorkspace(harness)
    await flush()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.scheduler.fire()
    }

    expect(screen.getByText('Automatic checking paused after repeated failures.')).toBeInTheDocument()
    expect(harness.scheduler.pendingCount()).toBe(0)

    fireEvent.click(screen.getByText('Keep checking'))
    await flush()
    expect(harness.scheduler.pendingCount()).toBe(1)
    // The render keeps its real status: the loop never rewrites it.
    expect(screen.queryByText('This attempt did not succeed')).toBeNull()
  })

  it('reports a playback problem without rewriting the render state', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      sceneSnapshots: {
        [CINEMA_TEST_SCENE_A]: () =>
          Promise.resolve(
            createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
              renders: [
                createTestRender(CINEMA_TEST_SCENE_A, 'render_1', {
                  status: 'completed',
                  attachments: [{ kind: 'file', path: '/videos/job-1.mp4', mimeType: 'video/mp4' }],
                }),
              ],
            }),
          ),
      },
    })
    await renderWorkspace(harness)
    await flush()

    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    fireEvent.error(video as HTMLVideoElement)
    await flush()

    expect(screen.getByText('Playback is unavailable; the render status is unchanged.')).toBeInTheDocument()
    expect(document.querySelector('video')).not.toBeNull()
    expect(screen.queryByText('This attempt did not succeed')).toBeNull()
  })

  it('keeps the previous success visible while a newer render runs', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      sceneSnapshots: {
        [CINEMA_TEST_SCENE_A]: () =>
          Promise.resolve(
            createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
              renders: [
                createTestRender(CINEMA_TEST_SCENE_A, 'render_done', {
                  status: 'completed',
                  attachments: [{ kind: 'file', path: '/videos/job-done.mp4', mimeType: 'video/mp4' }],
                }),
                createTestRender(CINEMA_TEST_SCENE_A, 'render_new', { status: 'queued' }),
              ],
            }),
          ),
      },
    })
    await renderWorkspace(harness)
    await flush()

    expect(document.querySelector('video')).not.toBeNull()
    expect(screen.getByText('A new video is rendering; below is the previous success')).toBeInTheDocument()
  })

  it('sends with Enter, keeps Shift+Enter for a newline and ignores an IME Enter', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    fireEvent.change(composer(), { target: { value: 'draw a circle' } })
    await flush()
    fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true })
    expect(harness.calls.createSceneRun).toEqual([])

    fireEvent.keyDown(composer(), { key: 'Enter' })
    await flush()
    expect(harness.calls.createSceneRun).toEqual([{ sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A }])

    fireEvent.compositionStart(composer())
    fireEvent.keyDown(composer(), { key: 'Enter' })
    await flush()
    expect(harness.calls.createSceneRun).toEqual([{ sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A }])
    fireEvent.compositionEnd(composer())
  })

  it('follows the bottom only when the reader is already there', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()

    fireEvent.click(catButton())
    await flush()
    const dialog = screen.getByRole('dialog')
    const list = dialog.querySelector('.overflow-y-auto') as HTMLDivElement
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true })

    list.scrollTop = 0
    await act(async () => {
      fireEvent.scroll(list)
      await Promise.resolve()
    })
    const jump = screen.getByText('Jump to latest')
    expect(jump).toBeInTheDocument()

    fireEvent.click(jump)
    await flush()
    expect(screen.queryByText('Jump to latest')).toBeNull()
  })

  // ---------------------------------------------------------------- correction R1
  it('applies a stored Scene only once the index is readable', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      selection: { [CINEMA_TEST_SESSION_ID]: CINEMA_TEST_SCENE_B },
      deferIndexRead: true,
    })
    await renderWorkspace(harness)
    await flush()

    // The index has not answered yet: nothing is selected, nothing is written, the choice survives.
    expect(screen.queryByRole('tab', { name: /Scene 1/ })).toBeNull()
    expect(harness.selectionStore.writes).toEqual([])
    expect(harness.selectionStore.entries.get(CINEMA_TEST_SESSION_ID)).toBe(CINEMA_TEST_SCENE_B)

    await act(async () => {
      harness.indexReads[0].resolve(harness.buildSessionSnapshot(CINEMA_TEST_SESSION_ID))
      await Promise.resolve()
    })
    await flush()

    expect(screen.getByRole('tab', { name: /Scene 2/ })).toHaveAttribute('aria-selected', 'true')
    expect(harness.selectionStore.entries.get(CINEMA_TEST_SESSION_ID)).toBe(CINEMA_TEST_SCENE_B)
  })

  it('does not read a failed index as an empty Session and applies the stored choice on retry', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      selection: { [CINEMA_TEST_SESSION_ID]: CINEMA_TEST_SCENE_C },
      deferIndexRead: true,
    })
    await renderWorkspace(harness)
    await flush()

    await act(async () => {
      harness.indexReads[0].reject(new TypeError('Failed to fetch'))
      await Promise.resolve()
    })
    await flush()

    expect(screen.getByText('The scene list could not be read.')).toBeInTheDocument()
    expect(harness.selectionStore.writes).toEqual([])
    expect(harness.selectionStore.entries.get(CINEMA_TEST_SESSION_ID)).toBe(CINEMA_TEST_SCENE_C)

    fireEvent.click(screen.getByText('Reload scenes'))
    await flush()
    expect(harness.indexReads.length).toBe(2)

    await act(async () => {
      harness.indexReads[1].resolve(harness.buildSessionSnapshot(CINEMA_TEST_SESSION_ID))
      await Promise.resolve()
    })
    await flush()

    expect(screen.getByRole('tab', { name: /Scene 3/ })).toHaveAttribute('aria-selected', 'true')
    expect(harness.selectionStore.entries.get(CINEMA_TEST_SESSION_ID)).toBe(CINEMA_TEST_SCENE_C)
  })

  it('restores each Session its own Scene across A to B and back to A', async () => {
    const harness = createHarness({
      history: [SESSION_A, SESSION_B],
      sceneIdsBySession: { [SESSION_A]: [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B], [SESSION_B]: ['scene_b_0001'] },
      selection: { [SESSION_A]: CINEMA_TEST_SCENE_B },
    })
    await renderWorkspace(harness)
    await flush()

    expect(screen.getByRole('tab', { name: /Scene 2/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByText('Session 2'))
    await flush()
    expect(screen.getByRole('tab', { name: /Scene 1/ })).toHaveAttribute('aria-selected', 'true')
    expect(harness.selectionStore.entries.get(SESSION_B)).toBe('scene_b_0001')
    expect(harness.selectionStore.entries.get(SESSION_A)).toBe(CINEMA_TEST_SCENE_B)

    fireEvent.click(screen.getByText('Session 1'))
    await flush()
    expect(screen.getByRole('tab', { name: /Scene 2/ })).toHaveAttribute('aria-selected', 'true')
  })

  // ---------------------------------------------------------------- correction R2
  it('closes every Scene-targeted action while a Session switch is pending', async () => {
    const harness = createHarness({
      history: [SESSION_A, SESSION_B],
      sceneIdsBySession: { [SESSION_A]: [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B], [SESSION_B]: ['scene_b_0001'] },
      deferGatewayReadsFrom: 1,
    })
    await renderWorkspace(harness)
    await flush()
    expect(screen.getByRole('tab', { name: /Scene 1/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.change(composer(), { target: { value: 'keep me' } })
    await flush()

    fireEvent.click(screen.getByText('Session 2'))
    await flush()

    // The Session being left keeps its screen and its draft, but nothing is actionable.
    expect(screen.getByText('Switching session…')).toBeInTheDocument()
    expect(screen.getByText('A session switch is in progress; one moment.')).toBeInTheDocument()
    expect(composer().value).toBe('keep me')
    expect(screen.getByLabelText('Send')).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Send'))
    fireEvent.click(screen.getByLabelText('Stop'))
    fireEvent.click(screen.getByLabelText('Add a Scene'))
    await flush()

    expect(harness.calls.createSceneRun).toEqual([])
    expect(harness.calls.cancelRun).toEqual([])
    expect(harness.calls.createScene).toEqual([])

    await act(async () => {
      harness.gatewayReads[0].resolve(harness.buildSessionSnapshot(SESSION_B))
      await Promise.resolve()
    })
    await flush()

    expect(screen.queryByText('Switching session…')).toBeNull()
    fireEvent.change(composer(), { target: { value: 'draw for b' } })
    await flush()
    fireEvent.click(screen.getByLabelText('Send'))
    await flush()

    expect(harness.calls.createSceneRun).toEqual([{ sessionId: SESSION_B, sceneId: 'scene_b_0001' }])
    // The background Run of the Session that was left is never cancelled.
    expect(harness.calls.cancelRun).toEqual([])
  })

  // ---------------------------------------------------------------- correction R3
  it('keeps following an answer that grows without adding a row', async () => {
    const geometry = installScrollGeometry()
    try {
      const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
      await renderWorkspace(harness)
      await flush()
      fireEvent.click(catButton())
      await flush()

      const subscription = harness.subscriptions[0]
      const text = (value: string) =>
        act(async () => {
          subscription?.options.onEvent({
            type: 'assistant.text',
            properties: {
              sessionId: CINEMA_TEST_SESSION_ID,
              sceneId: CINEMA_TEST_SCENE_A,
              runId: 'run_1',
              messageId: 'message_1',
              text: value,
            },
          } as never)
          await Promise.resolve()
        })

      await text('first chunk')
      const list = historyList()
      expect(harness.subscriptions.length).toBe(1)

      geometry.setScrollHeight(1400)
      await text('second chunk')

      // The row count never changed: only the content revision did, and the bottom reader followed it.
      expect(document.querySelectorAll('[role="dialog"] p').length).toBeGreaterThan(0)
      expect(list.scrollTop).toBe(1400)
      expect(screen.getByRole('dialog').textContent).toContain('second chunk')
    } finally {
      geometry.restore()
    }
  })

  it('restores the reading position of the same Scene when it is closed and reopened', async () => {
    const geometry = installScrollGeometry()
    try {
      const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
      await renderWorkspace(harness)
      await flush()
      fireEvent.click(catButton())
      await flush()

      const list = historyList()
      list.scrollTop = 120
      await act(async () => {
        fireEvent.scroll(list)
        await Promise.resolve()
      })
      expect(screen.getByText('Jump to latest')).toBeInTheDocument()

      // A reader who scrolled up is not dragged down by a growing answer.
      const subscription = harness.subscriptions[0]
      await act(async () => {
        subscription?.options.onEvent({
          type: 'assistant.text',
          properties: {
            sessionId: CINEMA_TEST_SESSION_ID,
            sceneId: CINEMA_TEST_SCENE_A,
            runId: 'run_1',
            messageId: 'message_1',
            text: 'a new chunk',
          },
        } as never)
        await Promise.resolve()
      })
      geometry.setScrollHeight(1600)
      await act(async () => {
        subscription?.options.onEvent({
          type: 'assistant.text',
          properties: {
            sessionId: CINEMA_TEST_SESSION_ID,
            sceneId: CINEMA_TEST_SCENE_A,
            runId: 'run_1',
            messageId: 'message_1',
            text: 'and another',
          },
        } as never)
        await Promise.resolve()
      })
      expect(list.scrollTop).toBe(120)

      fireEvent.click(screen.getByLabelText('Hide'))
      await flush()
      fireEvent.click(catButton())
      await flush()

      expect(historyList().scrollTop).toBe(120)
      expect(screen.getByText('Jump to latest')).toBeInTheDocument()
    } finally {
      geometry.restore()
    }
  })

  // ---------------------------------------------------------------- correction R4
  it('lays the sidebar out as a narrow-screen overlay and keeps the reason out of the input row', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      sceneSnapshots: {
        [CINEMA_TEST_SCENE_A]: () =>
          Promise.resolve(
            createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
              runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_running', 'running')],
            }),
          ),
      },
    })
    await renderWorkspace(harness)
    await flush()

    const sidebar = screen.getByLabelText('Sessions')
    expect(sidebar.className).toContain('absolute')
    expect(sidebar.className).toContain('lg:static')
    expect(screen.getByLabelText('Close session list')).toBeInTheDocument()

    const reason = screen.getByText('This Scene already has a running task; stop it first.')
    expect(reason.closest('.shrink-0')).toBeNull()
    expect(reason.closest('form')).not.toBeNull()
    expect(composer().className).toContain('min-w-0')
    expect(composer().className).toContain('flex-1')
  })

  // ---------------------------------------------------------------- correction R5
  it('writes no state and no history when a restore finishes after unmount', async () => {
    const harness = createHarness({ history: ['session_kept'], deferGatewayReadsFrom: 0 })
    await renderWorkspace(harness)
    await flush()
    expect(harness.gatewayReads.length).toBe(1)

    cleanup()
    await act(async () => {
      harness.gatewayReads[0].resolve(harness.buildSessionSnapshot('session_kept'))
      await Promise.resolve()
    })

    expect(harness.storage.size).toBe(0)
    expect(harness.selectionStore.writes).toEqual([])
  })

  it('records nothing for a create that finishes after unmount', async () => {
    const harness = createHarness({ history: [], deferCreateSession: true })
    await renderWorkspace(harness)
    await flush()
    expect(harness.createReads.length).toBe(1)

    cleanup()
    await act(async () => {
      harness.createReads[0].resolve({
        id: 'session_orphan',
        projectId: 'manimcat-studio',
        studioKind: 'manim',
        agentType: 'builder',
        title: 'Manim Studio',
        directory: '/workspace/session',
        createdAt: ISO,
        updatedAt: ISO,
      })
      await Promise.resolve()
    })

    // The request already left, so the Session may exist on the server; this client records nothing.
    expect(harness.storage.size).toBe(0)
    expect(harness.selectionStore.writes).toEqual([])
  })

  // ---------------------------------------------------------------- correction F1
  it('issues exactly one index read while the index is deferred, however much the UI re-renders', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID], deferIndexRead: true })
    await renderWorkspace(harness)
    await flush()

    expect(harness.indexReads.length).toBe(1)
    expect(harness.sessionReadCounts.controller).toBe(1)
    expect(harness.sessionReadCounts.gateway).toBe(1)

    // Unrelated re-renders and interactions: sidebar collapse/expand, typing, opening and closing the
    // composer's neighbourhood. None of them may restart the read, so no second request appears.
    fireEvent.click(screen.getByLabelText('Collapse session list'))
    fireEvent.click(screen.getByLabelText('Expand session list'))
    fireEvent.change(composer(), { target: { value: 'typed while the index loads' } })
    await flush()
    fireEvent.click(screen.getByLabelText('Collapse session list'))
    fireEvent.click(screen.getByLabelText('Expand session list'))
    await flush()

    expect(harness.indexReads.length).toBe(1)
    expect(harness.sessionReadCounts.controller).toBe(1)
    expect(harness.sessionReadCounts.gateway).toBe(1)

    // The single in-flight read still settles the selection when it finally answers.
    await act(async () => {
      harness.indexReads[0].resolve(harness.buildSessionSnapshot(CINEMA_TEST_SESSION_ID))
      await Promise.resolve()
    })
    await flush()
    expect(screen.getByRole('tab', { name: /Scene 1/ })).toHaveAttribute('aria-selected', 'true')
    expect(harness.selectionStore.entries.get(CINEMA_TEST_SESSION_ID)).toBe(CINEMA_TEST_SCENE_A)
  })

  it('reads the Session only once for a settled Scene, whatever the user does afterwards', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness)
    await flush()
    expect(harness.sessionReadCounts.controller).toBe(1)
    expect(harness.sessionReadCounts.gateway).toBe(1)

    const settled = { ...harness.sessionReadCounts }

    fireEvent.change(composer(), { target: { value: 'a draft is not a Session read' } })
    await flush()

    const subscription = harness.subscriptions[0]
    await act(async () => {
      subscription?.options.onEvent({
        type: 'assistant.text',
        properties: {
          sessionId: CINEMA_TEST_SESSION_ID,
          sceneId: CINEMA_TEST_SCENE_A,
          runId: 'run_1',
          messageId: 'message_1',
          text: 'streamed text is not a Session read',
        },
      } as never)
      await Promise.resolve()
    })

    fireEvent.click(catButton())
    fireEvent.click(catButton())
    fireEvent.click(screen.getByLabelText('Collapse session list'))
    fireEvent.click(screen.getByLabelText('Expand session list'))
    fireEvent.click(screen.getByRole('tab', { name: /Scene 2/ }))
    await flush()

    expect(harness.sessionReadCounts.controller).toBe(settled.controller)
    expect(harness.sessionReadCounts.gateway).toBe(settled.gateway)
  })

  it('adds exactly one read per explicit retry and never a chain', async () => {
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID], deferIndexRead: true })
    await renderWorkspace(harness)
    await flush()
    expect(harness.indexReads.length).toBe(1)

    await act(async () => {
      harness.indexReads[0].reject(new TypeError('Failed to fetch'))
      await Promise.resolve()
    })
    await flush()
    expect(harness.sessionReadCounts.controller).toBe(1)

    fireEvent.click(screen.getByText('Reload scenes'))
    await flush()
    expect(harness.indexReads.length).toBe(2)
    expect(harness.sessionReadCounts.controller).toBe(2)

    // Fixture correction 11C5-H3: a retry is only meaningful once the previous read has settled. The
    // in-flight read is rejected first, so the second retry measures its own read instead of chaining
    // onto a request that is still open.
    await act(async () => {
      harness.indexReads[1].reject(new TypeError('Failed to fetch'))
      await Promise.resolve()
    })
    await flush()

    fireEvent.click(screen.getByText('Reload scenes'))
    await flush()
    expect(harness.indexReads.length).toBe(3)
    expect(harness.sessionReadCounts.controller).toBe(3)
  })

  it('writes the applied decision back and clears the stored id of a genuinely empty index', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      indexScenes: [],
      selection: { [CINEMA_TEST_SESSION_ID]: CINEMA_TEST_SCENE_C },
    })
    await renderWorkspace(harness)
    await flush()

    // The index is readable and empty, so the stale stored id is dropped — and the persistence ran even
    // though the selection never changed (the applied decision is state, not a ref).
    expect(harness.selectionStore.entries.has(CINEMA_TEST_SESSION_ID)).toBe(false)
    expect(harness.selectionStore.writes).toEqual([
      { sessionId: CINEMA_TEST_SESSION_ID, sceneId: null },
    ])
    expect(screen.queryByRole('tab', { name: /Scene 1/ })).toBeNull()
  })

  it('writes a stored Scene back once the decision actually landed', async () => {
    const harness = createHarness({
      history: [CINEMA_TEST_SESSION_ID],
      selection: { [CINEMA_TEST_SESSION_ID]: CINEMA_TEST_SCENE_B },
    })
    await renderWorkspace(harness)
    await flush()

    expect(screen.getByRole('tab', { name: /Scene 2/ })).toHaveAttribute('aria-selected', 'true')
    expect(harness.selectionStore.writes).toEqual([
      { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_B },
    ])
  })

  // ---------------------------------------------------------------- correction F2
  it('writes no state and reads no history when a dependency rejects after unmount', async () => {
    const harness = createHarness({ history: [], deferCreateSession: true })
    await renderWorkspace(harness)
    await flush()
    expect(harness.createReads.length).toBe(1)
    const storageReadsBefore = harness.sessionReadCounts.storage

    cleanup()
    await act(async () => {
      harness.createReads[0].reject(new TypeError('Failed to fetch'))
      await Promise.resolve()
    })

    expect(harness.sessionReadCounts.storage).toBe(storageReadsBefore)
    expect(harness.storage.size).toBe(0)
    expect(harness.selectionStore.writes).toEqual([])
  })

  it('never touches global storage when the storage ports are injected', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    // Correction 11C5-H2: the contract is about *Studio* keys, not about every global write. The i18n
    // provider legitimately persists its locale, so the assertion is scoped to the Studio namespace
    // that the injected storage port owns (session-storage.ts SESSION_STORAGE_PREFIX).
    const studioKeysOf = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map((call) => String(call[0])).filter((key) => key.startsWith('manimcat:studio'))
    try {
      const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
      await renderWorkspace(harness)
      await flush()

      expect(studioKeysOf(setItem)).toEqual([])
      expect(studioKeysOf(removeItem)).toEqual([])
      expect(studioKeysOf(getItem)).toEqual([])
      // The injected port really is the one that was used, so the three assertions above are not vacuous.
      expect(harness.selectionStore.writes.length).toBeGreaterThan(0)
    } finally {
      setItem.mockRestore()
      getItem.mockRestore()
      removeItem.mockRestore()
    }
  })

  it('aborts every stream on unmount and calls onExit from the exit button', async () => {
    let exits = 0
    const harness = createHarness({ history: [CINEMA_TEST_SESSION_ID] })
    await renderWorkspace(harness, { onExit: () => (exits += 1) })
    await flush()

    fireEvent.click(screen.getByLabelText('Exit studio'))
    expect(exits).toBe(1)

    const subscription = harness.subscriptions[0]
    expect(subscription?.isAborted()).toBe(false)
    cleanup()
    expect(subscription?.isAborted()).toBe(true)
  })
})
