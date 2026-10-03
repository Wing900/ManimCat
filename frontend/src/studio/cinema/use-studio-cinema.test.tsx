import { StrictMode, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { StudioSession } from '../protocol/studio-agent-types'
import type { StudioEventSubscriptionOptions } from '../api/studio-agent-events'
import type { StudioCinemaControllerDependencies } from './cinema-controller'
import { useStudioCinema } from './use-studio-cinema'
import {
  CINEMA_TEST_SCENE_A,
  CINEMA_TEST_SCENE_B,
  CINEMA_TEST_SESSION_ID,
  createTestRun,
  createTestScene,
  createTestSceneSnapshot,
} from './cinema-fixtures'

/**
 * Binding lifecycle specs (task 11C1, section 5, and the R1 correction).
 *
 * These are real React specs: the hook is mounted inside `StrictMode` with fake dependencies, so the
 * setup → cleanup → setup replay is the one React actually performs, and no network, socket or timer
 * is involved. `detach` (the effect cleanup) must keep the instance reusable while `dispose` is
 * terminal, so a replayed setup never finds a dead controller.
 *
 * The counts below are deliberately replay-agnostic where React's own double invocation decides how
 * often a setup runs; what is asserted is the invariant (one live controller, the recovery read
 * applied, one live subscription at most, nothing created by a binding).
 */

interface FakeStream {
  options: StudioEventSubscriptionOptions
  isAborted: () => boolean
}

function StrictWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>
}

function createSession(sessionId: string): StudioSession {
  return {
    id: sessionId,
    projectId: 'project_1',
    agentType: 'builder',
    title: 'Cinema',
    directory: 'scenes/workspace',
    createdAt: '2026-03-22T00:00:00.000Z',
    updatedAt: '2026-03-22T00:00:00.000Z',
  }
}

function createHookHarness(scenesBySession: Record<string, string[]> = {}) {
  const calls = {
    createScene: [] as string[],
    getSessionSnapshot: [] as string[],
    getSceneSnapshot: [] as string[],
  }
  const streams: FakeStream[] = []

  const overrides: Partial<StudioCinemaControllerDependencies> = {
    api: {
      createScene: (sessionId) => {
        calls.createScene.push(sessionId)
        return Promise.resolve(
          createTestScene(sessionId, `scene_${calls.createScene.length}`, calls.createScene.length),
        )
      },
      reorderScenes: async (_sessionId, sceneIds) =>
        sceneIds.map((sceneId, index) => createTestScene(CINEMA_TEST_SESSION_ID, sceneId, index)),
      getSceneSnapshot: (sessionId, sceneId) => {
        calls.getSceneSnapshot.push(sceneId)
        return Promise.resolve(createTestSceneSnapshot(sessionId, sceneId))
      },
      getSessionSnapshot: (sessionId) => {
        calls.getSessionSnapshot.push(sessionId)
        return Promise.resolve({
          session: createSession(sessionId),
          messages: [],
          runs: [],
          renders: [],
          scenes: (scenesBySession[sessionId] ?? []).map((sceneId, index) =>
            createTestScene(sessionId, sceneId, index),
          ),
        })
      },
      createSceneRun: (sessionId, sceneId) =>
        Promise.resolve({
          ...createTestSceneSnapshot(sessionId, sceneId),
          run: createTestRun(sceneId, 'run_hook', 'running', sessionId),
        }),
      cancelRun: () => Promise.resolve({ status: 'cancelled' }),
    },
    events: {
      subscribe: (options) => {
        streams.push({ options, isAborted: () => options.signal.aborted })
        return Promise.resolve()
      },
    },
    clock: { now: () => 1_700_000_000_000 },
    createAbortController: () => new AbortController(),
    createWorkflowId: () => 'workflow_hook',
  }

  return { calls, streams, overrides }
}

function liveStreams(streams: FakeStream[]): FakeStream[] {
  return streams.filter((stream) => !stream.isAborted())
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 24; index += 1) {
      await Promise.resolve()
    }
  })
}

describe('useStudioCinema binding', () => {
  it('survives a StrictMode replay with a live controller and an applied recovery read', async () => {
    const harness = createHookHarness({
      [CINEMA_TEST_SESSION_ID]: [CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B],
    })
    const session = createSession(CINEMA_TEST_SESSION_ID)

    const { result } = renderHook(() => useStudioCinema({ session, overrides: harness.overrides }), {
      wrapper: StrictWrapper,
    })
    await flush()

    // The replayed setup re-armed the same instance instead of finding a disposed controller, and the
    // recovery read of the new binding was the one that landed.
    const controller = result.current.controller
    expect(controller.isDisposed()).toBe(false)
    expect(controller.isAttached()).toBe(true)
    expect(result.current.state.session.id).toBe(CINEMA_TEST_SESSION_ID)
    expect(result.current.state.sceneOrder).toEqual([CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    expect([...new Set(harness.calls.getSessionSnapshot)]).toEqual([CINEMA_TEST_SESSION_ID])
    expect(harness.calls.createScene).toHaveLength(0)
    expect(liveStreams(harness.streams).length).toBeLessThanOrEqual(1)

    // Selecting a Scene opens exactly one stream, and the effect cleanup/setup pair (detach then
    // attach plus the selection restore the hook performs) leaves exactly one live stream again.
    act(() => {
      controller.selectScene(CINEMA_TEST_SCENE_A)
    })
    await flush()
    expect(liveStreams(harness.streams)).toHaveLength(1)

    act(() => {
      controller.detach()
    })
    expect(liveStreams(harness.streams)).toHaveLength(0)

    act(() => {
      controller.attach()
      controller.resumeSelectedScene()
    })
    await flush()
    expect(liveStreams(harness.streams)).toHaveLength(1)
    expect(result.current.state.selectedSceneId).toBe(CINEMA_TEST_SCENE_A)
    expect(harness.calls.getSceneSnapshot).toContain(CINEMA_TEST_SCENE_A)
  })

  it('detaches on unmount, aborts the stream and drops every later write', async () => {
    const harness = createHookHarness({ [CINEMA_TEST_SESSION_ID]: [CINEMA_TEST_SCENE_A] })
    const session = createSession(CINEMA_TEST_SESSION_ID)

    const { result, unmount } = renderHook(
      () => useStudioCinema({ session, overrides: harness.overrides }),
      { wrapper: StrictWrapper },
    )
    await flush()

    const controller = result.current.controller
    act(() => {
      controller.selectScene(CINEMA_TEST_SCENE_A)
    })
    await flush()
    const liveBefore = liveStreams(harness.streams)
    expect(liveBefore).toHaveLength(1)

    unmount()

    // The cleanup detaches instead of disposing, so the instance stays reusable, and the stream is
    // really aborted rather than merely ignored.
    expect(controller.isAttached()).toBe(false)
    expect(controller.isDisposed()).toBe(false)
    expect(liveStreams(harness.streams)).toHaveLength(0)

    const before = controller.getState()
    await act(async () => {
      liveBefore[0]?.options.onEvent({ type: 'studio.heartbeat', properties: { timestamp: 1 } })
      await Promise.resolve()
    })
    expect(controller.getState()).toBe(before)
  })

  it('keeps one controller instance across a Session change and closes the old stream', async () => {
    const harness = createHookHarness({
      [CINEMA_TEST_SESSION_ID]: [CINEMA_TEST_SCENE_A],
      session_other: [CINEMA_TEST_SCENE_B],
    })

    const { result, rerender } = renderHook(
      ({ session }: { session: StudioSession }) => useStudioCinema({ session, overrides: harness.overrides }),
      { wrapper: StrictWrapper, initialProps: { session: createSession(CINEMA_TEST_SESSION_ID) } },
    )
    await flush()
    const controller = result.current.controller
    act(() => {
      controller.selectScene(CINEMA_TEST_SCENE_A)
    })
    await flush()
    expect(liveStreams(harness.streams)).toHaveLength(1)
    expect(harness.calls.createScene).toHaveLength(0)

    rerender({ session: createSession('session_other') })
    await flush()

    expect(result.current.controller).toBe(controller)
    expect(result.current.state.session.id).toBe('session_other')
    // A different Session starts from an empty state and carries only its own Scene.
    expect(result.current.state.sceneOrder).toEqual([CINEMA_TEST_SCENE_B])
    expect(harness.calls.getSessionSnapshot).toContain('session_other')
    expect([...new Set(harness.calls.getSessionSnapshot)]).toEqual([
      CINEMA_TEST_SESSION_ID,
      'session_other',
    ])
    expect(harness.calls.createScene).toHaveLength(0)
  })

  it('replaces a disposed controller instead of reusing a dead instance', async () => {
    const harness = createHookHarness({ [CINEMA_TEST_SESSION_ID]: [CINEMA_TEST_SCENE_A] })
    const session = createSession(CINEMA_TEST_SESSION_ID)

    const { result, rerender } = renderHook(
      () => useStudioCinema({ session, overrides: harness.overrides }),
      { wrapper: StrictWrapper },
    )
    await flush()

    const first = result.current.controller
    act(() => {
      first.dispose()
    })
    expect(first.isDisposed()).toBe(true)

    rerender()
    await flush()

    // A terminal controller is never re-entered: a fresh instance takes over and is bound again.
    expect(result.current.controller).not.toBe(first)
    expect(result.current.controller.isDisposed()).toBe(false)
    expect(result.current.controller.isAttached()).toBe(true)
    expect(result.current.state.sceneOrder).toEqual([CINEMA_TEST_SCENE_A])
    expect(liveStreams(harness.streams).length).toBeLessThanOrEqual(1)
    expect(harness.calls.createScene).toHaveLength(0)
  })
})
