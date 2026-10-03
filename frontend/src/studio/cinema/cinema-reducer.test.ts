import { describe, expect, it } from 'vitest'
import type { StudioScene } from '../protocol/studio-agent-types'
import { selectSceneState, studioCinemaReducer, type StudioCinemaAction } from './scene-state'
import { readStudioCinemaActiveRun } from './scene-selectors'
import { createInitialStudioCinemaState, type StudioCinemaState } from './types'
import {
  CINEMA_TEST_SCENE_A,
  CINEMA_TEST_SCENE_B,
  CINEMA_TEST_SCENE_C,
  CINEMA_TEST_SESSION_ID,
  createTestAssistantTextEvent,
  createTestRun,
  createTestRender,
  createTestScene,
  createTestSceneSnapshot,
  createTestToolResultEvent,
} from './cinema-fixtures'

/**
 * Scene state specs (task 11C1, sections 5 and 6, and the R2/R4/R5 corrections). The reducer is
 * pure, so every rule — scope match, Session generation, composite-key selection, terminal
 * stickiness, delta order, Tool merge, draft version, convergence — is verified without a network
 * call, a socket or a clock.
 */

const IDENTITY_A = { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_A }
const IDENTITY_B = { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_B }

function openState(): StudioCinemaState {
  return studioCinemaReducer(createInitialStudioCinemaState(), {
    type: 'session/opened',
    sessionId: CINEMA_TEST_SESSION_ID,
    generation: 1,
    title: 'Cinema',
    projectId: 'project_1',
  })
}

/** Session level actions carry the generation they were produced in. */
function withScenes(state: StudioCinemaState, scenes: StudioScene[]): StudioCinemaState {
  return studioCinemaReducer(state, {
    type: 'session/index',
    generation: state.session.generation,
    scenes,
  })
}

function dispatchMany(state: StudioCinemaState, actions: StudioCinemaAction[]): StudioCinemaState {
  return actions.reduce((current, action) => studioCinemaReducer(current, action), state)
}

function sceneStateOf(state: StudioCinemaState, sceneId: string) {
  const record = selectSceneState(state, { sessionId: CINEMA_TEST_SESSION_ID, sceneId })
  if (!record) {
    throw new Error(`missing scene state for ${sceneId}`)
  }
  return record
}

describe('studio cinema scene reducer', () => {
  it('opens a session with an empty scene map and resets on a different session', () => {
    const opened = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    expect(opened.sceneOrder).toEqual([CINEMA_TEST_SCENE_A])

    const switched = studioCinemaReducer(opened, {
      type: 'session/opened',
      sessionId: 'session_other',
      generation: 2,
      title: null,
      projectId: null,
    })
    expect(switched.session.id).toBe('session_other')
    expect(switched.sceneOrder).toEqual([])
    expect(Object.keys(switched.scenes)).toEqual([])

    // Re-opening the same Session keeps the Scene records (a refresh is not a reset).
    const reopened = studioCinemaReducer(opened, {
      type: 'session/opened',
      sessionId: CINEMA_TEST_SESSION_ID,
      generation: 3,
      title: null,
      projectId: null,
    })
    expect(reopened.sceneOrder).toEqual([CINEMA_TEST_SCENE_A])
    expect(reopened.session.generation).toBe(3)
  })

  it('drops a session action that names an older generation', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const reopened = studioCinemaReducer(base, {
      type: 'session/opened',
      sessionId: CINEMA_TEST_SESSION_ID,
      generation: 5,
      title: null,
      projectId: null,
    })

    // The state now belongs to generation 5: an action of the old workflow cannot touch it.
    const stale = dispatchMany(reopened, [
      { type: 'session/feedback', generation: 4, feedback: { code: 'scene_create_unknown', needsReconciliation: true } },
      { type: 'session/mutation-pending', generation: 4, pending: true },
      { type: 'initialization/patch', generation: 4, patch: { status: 'ready', createdCount: 99 } },
      { type: 'session/index', generation: 4, scenes: [] },
      { type: 'scene/selected', generation: 4, sceneId: CINEMA_TEST_SCENE_A },
    ])

    expect(stale).toBe(reopened)
    expect(sceneStateOf(stale, CINEMA_TEST_SCENE_A).messages).toHaveLength(0)
  })

  it('orders the scene index by position and keeps a selection only while it exists', () => {
    const state = dispatchMany(openState(), [
      { type: 'scene/selected', generation: 1, sceneId: CINEMA_TEST_SCENE_B },
      {
        type: 'session/index',
        generation: 1,
        scenes: [
          createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B, 0),
          createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 1),
          createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_C, 2),
        ],
      },
    ])

    expect(state.sceneOrder).toEqual([CINEMA_TEST_SCENE_B, CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_C])
    expect(state.selectedSceneId).toBe(CINEMA_TEST_SCENE_B)

    // A Scene removed from the index also clears the selection and its record.
    const removed = studioCinemaReducer(state, {
      type: 'session/index',
      generation: 1,
      scenes: [
        createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 1),
        createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_C, 2),
      ],
    })
    expect(removed.sceneOrder).toEqual([CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_C])
    expect(removed.selectedSceneId).toBeNull()
    expect(selectSceneState(removed, IDENTITY_B)).toBeNull()
  })

  it('keeps a selection and its draft across a refresh and refuses Scenes of another Session', () => {
    const base = dispatchMany(openState(), [
      { type: 'scene/selected', generation: 1, sceneId: CINEMA_TEST_SCENE_A },
      {
        type: 'session/index',
        generation: 1,
        scenes: [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)],
      },
      { type: 'draft/changed', identity: IDENTITY_A, text: 'typed' },
    ])

    // The Scene map is keyed by the composite key, so the refresh must find the selection again.
    const refreshed = withScenes(base, [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    expect(refreshed.selectedSceneId).toBe(CINEMA_TEST_SCENE_A)
    expect(sceneStateOf(refreshed, CINEMA_TEST_SCENE_A).draft).toBe('typed')

    // A Scene record of a foreign Session can never enter this index or be created here.
    const foreign = withScenes(base, [
      { ...createTestScene('session_other', CINEMA_TEST_SCENE_B, 0) },
    ])
    expect(foreign.sceneOrder).toEqual([CINEMA_TEST_SCENE_A])
    expect(selectSceneState(foreign, IDENTITY_B)).toBeNull()

    const created = studioCinemaReducer(base, {
      type: 'scene/created',
      scene: createTestScene('session_other', 'scene_foreign', 1),
    })
    expect(created).toBe(base)
  })

  it('adds a created scene idempotently and never touches the selection', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const created = studioCinemaReducer(base, {
      type: 'scene/created',
      scene: createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B, 1),
    })
    const repeated = studioCinemaReducer(created, {
      type: 'scene/created',
      scene: createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B, 1),
    })

    expect(repeated.sceneOrder).toEqual([CINEMA_TEST_SCENE_A, CINEMA_TEST_SCENE_B])
    expect(repeated.selectedSceneId).toBeNull()
  })

  it('replaces the conversation from a snapshot and never downgrades a terminal record', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const withTerminal = dispatchMany(base, [
      { type: 'scene/event', identity: IDENTITY_A, event: { kind: 'run-updated', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'completed') }, receivedAt: 10 },
      { type: 'scene/event', identity: IDENTITY_A, event: { kind: 'render-updated', render: createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'completed' }) }, receivedAt: 10 },
    ])

    const merged = studioCinemaReducer(withTerminal, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running')],
        renders: [createTestRender(CINEMA_TEST_SCENE_A, 'render_1', { status: 'running' })],
      }),
    })

    const record = sceneStateOf(merged, CINEMA_TEST_SCENE_A)
    expect(record.snapshotStatus).toBe('ready')
    expect(record.runs[0]?.status).toBe('completed')
    expect(record.renders[0]?.status).toBe('completed')
  })

  it('ignores a late active update after a terminal status', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const state = dispatchMany(base, [
      { type: 'scene/event', identity: IDENTITY_A, event: { kind: 'run-updated', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'completed') }, receivedAt: 1 },
      { type: 'scene/event', identity: IDENTITY_A, event: { kind: 'run-updated', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running') }, receivedAt: 2 },
    ])

    expect(sceneStateOf(state, CINEMA_TEST_SCENE_A).runs[0]?.status).toBe('completed')
  })

  it('appends assistant deltas in order and keeps two identical chunks', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const state = dispatchMany(base, [
      { type: 'scene/event', identity: IDENTITY_A, event: createTestAssistantTextEvent('ab'), receivedAt: 1 },
      { type: 'scene/event', identity: IDENTITY_A, event: createTestAssistantTextEvent('ab'), receivedAt: 2 },
    ])

    const message = sceneStateOf(state, CINEMA_TEST_SCENE_A).messages[0]
    expect(message?.role).toBe('assistant')
    const parts = message?.role === 'assistant' ? message.parts : []
    expect(parts).toHaveLength(1)
    expect(parts[0]?.type === 'text' ? parts[0].text : '').toBe('abab')
  })

  it('merges tool parts by message and call id, dropping the text of a failed result', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const state = dispatchMany(base, [
      {
        type: 'scene/event',
        identity: IDENTITY_A,
        event: { kind: 'tool-input-start', runId: 'run_1', messageId: 'message_1', toolName: 'static-check', callId: 'call_1' },
        receivedAt: 1,
      },
      { type: 'scene/event', identity: IDENTITY_A, event: createTestToolResultEvent({ output: 'Static check completed: 2 diagnostics.' }), receivedAt: 2 },
      { type: 'scene/event', identity: IDENTITY_A, event: createTestToolResultEvent({ status: 'failed', output: 'ENOENT: D:/private' }), receivedAt: 3 },
    ])

    const message = sceneStateOf(state, CINEMA_TEST_SCENE_A).messages[0]
    const parts = message?.role === 'assistant' ? message.parts : []
    expect(parts).toHaveLength(1)
    const part = parts[0]
    expect(part?.type).toBe('tool')
    if (part?.type !== 'tool') {
      throw new Error('expected a tool part')
    }
    expect(part.callId).toBe('call_1')
    expect(part.state.status).toBe('error')
    expect(part.state.output).toBeUndefined()
    expect(JSON.stringify(part).includes('D:/private')).toBe(false)
  })

  it('clears only the draft version a submit captured, keeping text typed while waiting', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const accepted = {
      ...createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A),
      run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running'),
    }

    const captured = dispatchMany(base, [
      { type: 'draft/changed', identity: IDENTITY_A, text: 'draw' },
      { type: 'submit/started', identity: IDENTITY_A },
      { type: 'submit/accepted', identity: IDENTITY_A, response: accepted },
    ])
    const capturedRecord = sceneStateOf(captured, CINEMA_TEST_SCENE_A)
    expect(capturedRecord.draft).toBe('')
    expect(capturedRecord.submitting).toBe(false)
    // The accepted Run is derived from the public records, not from a second stored id.
    expect(readStudioCinemaActiveRun(capturedRecord)?.id).toBe('run_1')

    const retyped = dispatchMany(base, [
      { type: 'draft/changed', identity: IDENTITY_A, text: 'draw' },
      { type: 'submit/started', identity: IDENTITY_A },
      { type: 'draft/changed', identity: IDENTITY_A, text: 'draw a square' },
      { type: 'submit/accepted', identity: IDENTITY_A, response: accepted },
    ])
    expect(sceneStateOf(retyped, CINEMA_TEST_SCENE_A).draft).toBe('draw a square')
  })

  // Correction 11C6-P3: the accepted response's top-level `run` is the accepted Run and must reach
  // the state even when the `runs` array does not carry it. `upsertSceneRun` stays the only rule.
  it('merges the accepted run from the response top level, once per id', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const acceptedRun = createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running')
    const response = {
      ...createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A),
      runs: [],
      run: acceptedRun,
    }

    const state = dispatchMany(base, [
      { type: 'draft/changed', identity: IDENTITY_A, text: 'draw' },
      { type: 'submit/started', identity: IDENTITY_A },
      { type: 'submit/accepted', identity: IDENTITY_A, response },
    ])
    const record = sceneStateOf(state, CINEMA_TEST_SCENE_A)
    expect(readStudioCinemaActiveRun(record)?.id).toBe('run_1')
    expect(record.runs.filter((run) => run.id === 'run_1')).toHaveLength(1)

    // A response that also lists the same Run in `runs` still yields exactly one entry.
    const duplicated = dispatchMany(base, [
      { type: 'submit/started', identity: IDENTITY_A },
      { type: 'submit/accepted', identity: IDENTITY_A, response: { ...response, runs: [acceptedRun] } },
    ])
    const duplicatedRecord = sceneStateOf(duplicated, CINEMA_TEST_SCENE_A)
    expect(duplicatedRecord.runs.filter((run) => run.id === 'run_1')).toHaveLength(1)
    expect(readStudioCinemaActiveRun(duplicatedRecord)?.id).toBe('run_1')
  })

  it('never lets a late accepted run downgrade a terminal run', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const state = dispatchMany(base, [
      {
        type: 'scene/snapshot',
        identity: IDENTITY_A,
        snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
          runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'completed')],
          renders: [],
        }),
      },
      { type: 'submit/started', identity: IDENTITY_A },
      {
        type: 'submit/accepted',
        identity: IDENTITY_A,
        response: {
          ...createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A),
          runs: [],
          run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running'),
        },
      },
    ])

    const record = sceneStateOf(state, CINEMA_TEST_SCENE_A)
    expect(record.runs.find((run) => run.id === 'run_1')?.status).toBe('completed')
    expect(readStudioCinemaActiveRun(record)).toBeNull()
  })

  it('refuses an accepted response whose identity has no Scene record', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const state = studioCinemaReducer(base, {
      type: 'submit/accepted',
      identity: { sessionId: CINEMA_TEST_SESSION_ID, sceneId: CINEMA_TEST_SCENE_B },
      response: {
        ...createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B),
        runs: [],
        run: createTestRun(CINEMA_TEST_SCENE_B, 'run_b', 'running'),
      },
    })

    // The named Scene has no record, so nothing is injected - and the sibling stays untouched.
    expect(sceneStateOf(state, CINEMA_TEST_SCENE_A).runs).toHaveLength(0)
    expect(sceneStateOf(state, CINEMA_TEST_SCENE_A).messages).toHaveLength(0)
  })

  // Task 11C7-A: the payload must belong to the Scene the action names. A valid action identity is
  // not proof that the response is scoped to it, so a foreign payload is rejected atomically.
  it('rejects a snapshot whose Scene belongs to another Session', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const seeded = dispatchMany(base, [
      {
        type: 'scene/snapshot',
        identity: IDENTITY_A,
        snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
          runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_a', 'running')],
        }),
      },
    ])
    const rejected = studioCinemaReducer(seeded, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot('session_other', CINEMA_TEST_SCENE_A, {
        runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_other', 'running', 'session_other')],
      }),
    })

    expect(sceneStateOf(rejected, CINEMA_TEST_SCENE_A)).toEqual(sceneStateOf(seeded, CINEMA_TEST_SCENE_A))
  })

  it('rejects a snapshot that carries a record from a sibling Scene or a Legacy record', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const seeded = dispatchMany(base, [
      {
        type: 'scene/snapshot',
        identity: IDENTITY_A,
        snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
          runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_a', 'running')],
        }),
      },
    ])
    const expected = sceneStateOf(seeded, CINEMA_TEST_SCENE_A)

    const siblingRun = studioCinemaReducer(seeded, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        runs: [createTestRun(CINEMA_TEST_SCENE_B, 'run_b', 'running')],
      }),
    })
    expect(sceneStateOf(siblingRun, CINEMA_TEST_SCENE_A)).toEqual(expected)

    const siblingRender = studioCinemaReducer(seeded, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        renders: [createTestRender(CINEMA_TEST_SCENE_B, 'render_b', { status: 'queued' })],
      }),
    })
    expect(sceneStateOf(siblingRender, CINEMA_TEST_SCENE_A)).toEqual(expected)

    // A record that carries no `sceneId` is a Legacy record: it does not belong to this Scene.
    const legacyRun = studioCinemaReducer(seeded, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        runs: [{ ...createTestRun(CINEMA_TEST_SCENE_A, 'run_legacy', 'running'), sceneId: undefined }],
      }),
    })
    expect(sceneStateOf(legacyRun, CINEMA_TEST_SCENE_A)).toEqual(expected)
  })

  it('rejects a snapshot whose message or nested part belongs to another scope', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const seeded = dispatchMany(base, [
      {
        type: 'scene/snapshot',
        identity: IDENTITY_A,
        snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A),
      },
    ])
    const expected = sceneStateOf(seeded, CINEMA_TEST_SCENE_A)

    const siblingMessage = studioCinemaReducer(seeded, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [
          {
            id: 'message_b',
            sessionId: CINEMA_TEST_SESSION_ID,
            sceneId: CINEMA_TEST_SCENE_B,
            role: 'user',
            text: 'hello',
            createdAt: '2026-03-22T00:00:00.000Z',
            updatedAt: '2026-03-22T00:00:00.000Z',
          },
        ],
      }),
    })
    expect(sceneStateOf(siblingMessage, CINEMA_TEST_SCENE_A)).toEqual(expected)

    // The part's own identity belongs to another message, so the whole response is refused.
    const foreignPart = studioCinemaReducer(seeded, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
        messages: [
          {
            id: 'message_a',
            sessionId: CINEMA_TEST_SESSION_ID,
            role: 'assistant',
            agent: 'builder',
            parts: [
              { id: 'part_1', messageId: 'message_other', sessionId: CINEMA_TEST_SESSION_ID, type: 'text', text: 'hi' },
            ],
            createdAt: '2026-03-22T00:00:00.000Z',
            updatedAt: '2026-03-22T00:00:00.000Z',
          },
        ],
      }),
    })
    expect(sceneStateOf(foreignPart, CINEMA_TEST_SCENE_A)).toEqual(expected)
  })

  it('rejects an accepted response whose snapshot or top-level run is not scoped to the Scene', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const seeded = dispatchMany(base, [
      { type: 'draft/changed', identity: IDENTITY_A, text: 'draw' },
      { type: 'submit/started', identity: IDENTITY_A },
    ])
    const expected = sceneStateOf(seeded, CINEMA_TEST_SCENE_A)
    const response = {
      ...createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A),
      run: createTestRun(CINEMA_TEST_SCENE_B, 'run_b', 'running'),
    }

    const rejected = studioCinemaReducer(seeded, { type: 'submit/accepted', identity: IDENTITY_A, response })
    expect(sceneStateOf(rejected, CINEMA_TEST_SCENE_A)).toEqual(expected)
  })

  it('rejects a cancel settlement whose Run belongs to another Scene', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const seeded = dispatchMany(base, [
      {
        type: 'scene/snapshot',
        identity: IDENTITY_A,
        snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
          runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_a', 'running')],
        }),
      },
      { type: 'cancel/started', identity: IDENTITY_A },
    ])

    const rejected = studioCinemaReducer(seeded, {
      type: 'cancel/settled',
      identity: IDENTITY_A,
      run: createTestRun(CINEMA_TEST_SCENE_B, 'run_b', 'cancelled'),
    })
    const record = sceneStateOf(rejected, CINEMA_TEST_SCENE_A)
    expect(record.runs.some((run) => run.id === 'run_b')).toBe(false)
    expect(record.cancelRequested).toBe(false)
  })

  // 11C7 Review Correction: the cancel settlement carries its requested target, and a Run that is not
  // that target is never written - the reducer proves the write boundary on its own.
  it('refuses a cancel settlement whose Run is not the requested target', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const seeded = dispatchMany(base, [
      {
        type: 'scene/snapshot',
        identity: IDENTITY_A,
        snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, {
          runs: [createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running'), createTestRun(CINEMA_TEST_SCENE_A, 'run_2', 'running')],
        }),
      },
      { type: 'cancel/started', identity: IDENTITY_A },
    ])

    const settled = studioCinemaReducer(seeded, {
      type: 'cancel/settled',
      identity: IDENTITY_A,
      targetRunId: 'run_1',
      run: createTestRun(CINEMA_TEST_SCENE_A, 'run_2', 'cancelled'),
    })
    const record = sceneStateOf(settled, CINEMA_TEST_SCENE_A)
    expect(record.runs.find((run) => run.id === 'run_2')?.status).toBe('running')
    expect(record.cancelRequested).toBe(false)

    const rejected = studioCinemaReducer(seeded, {
      type: 'cancel/settled',
      identity: IDENTITY_A,
      targetRunId: 'run_1',
      code: 'run_cancel_failed',
      needsReconciliation: true,
    })
    expect(sceneStateOf(rejected, CINEMA_TEST_SCENE_A).feedback).toEqual({
      code: 'run_cancel_failed',
      needsReconciliation: true,
    })
  })

  it('keeps the draft on failure and flags an unknown outcome for reconciliation', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const state = dispatchMany(base, [
      { type: 'draft/changed', identity: IDENTITY_A, text: 'draw' },
      { type: 'submit/started', identity: IDENTITY_A },
      { type: 'submit/failed', identity: IDENTITY_A, code: 'run_submit_unknown', unknownOutcome: true },
    ])

    const record = sceneStateOf(state, CINEMA_TEST_SCENE_A)
    expect(record.draft).toBe('draw')
    expect(record.submitting).toBe(false)
    expect(record.needsReconciliation).toBe(true)
    expect(record.feedback).toEqual({ code: 'run_submit_unknown', needsReconciliation: true })

    // A later successful snapshot is the convergence checkpoint and resolves the flag.
    const resolved = studioCinemaReducer(state, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A),
    })
    expect(sceneStateOf(resolved, CINEMA_TEST_SCENE_A).needsReconciliation).toBe(false)
    expect(sceneStateOf(resolved, CINEMA_TEST_SCENE_A).feedback).toBeNull()
  })

  it('keeps a pending convergence until an authoritative read resolves it', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const pending = studioCinemaReducer(base, {
      type: 'scene/convergence-pending',
      identity: IDENTITY_A,
      at: 42,
    })

    const record = sceneStateOf(pending, CINEMA_TEST_SCENE_A)
    expect(record.convergencePending).toBe(true)
    expect(record.resyncedAt).toBe(42)
    expect(record.feedback?.code).toBe('stream_resync')

    // A recovery window that opens does not clear the flag by itself; the snapshot does.
    const loading = studioCinemaReducer(pending, { type: 'scene/recovery-started', identity: IDENTITY_A })
    expect(sceneStateOf(loading, CINEMA_TEST_SCENE_A).convergencePending).toBe(true)

    const converged = studioCinemaReducer(loading, {
      type: 'scene/snapshot',
      identity: IDENTITY_A,
      snapshot: createTestSceneSnapshot(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A),
    })
    expect(sceneStateOf(converged, CINEMA_TEST_SCENE_A).convergencePending).toBe(false)
  })

  it('keeps a busy scene isolated from its sibling', () => {
    const base = withScenes(openState(), [
      createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0),
      createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_B, 1),
    ])
    const state = dispatchMany(base, [
      { type: 'draft/changed', identity: IDENTITY_A, text: 'a' },
      { type: 'draft/changed', identity: IDENTITY_B, text: 'b' },
      { type: 'submit/started', identity: IDENTITY_A },
      { type: 'scene/event', identity: IDENTITY_B, event: createTestAssistantTextEvent('b text'), receivedAt: 1 },
    ])

    expect(sceneStateOf(state, CINEMA_TEST_SCENE_A).submitting).toBe(true)
    expect(sceneStateOf(state, CINEMA_TEST_SCENE_A).draft).toBe('a')
    expect(sceneStateOf(state, CINEMA_TEST_SCENE_B).submitting).toBe(false)
    expect(sceneStateOf(state, CINEMA_TEST_SCENE_B).draft).toBe('b')
    expect(sceneStateOf(state, CINEMA_TEST_SCENE_B).messages).toHaveLength(1)
    expect(sceneStateOf(state, CINEMA_TEST_SCENE_A).messages).toHaveLength(0)
  })

  it('tracks a cancel request and settles it with a narrowed run', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const state = dispatchMany(base, [
      { type: 'scene/event', identity: IDENTITY_A, event: { kind: 'run-updated', run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'running') }, receivedAt: 1 },
      { type: 'cancel/started', identity: IDENTITY_A },
    ])
    expect(sceneStateOf(state, CINEMA_TEST_SCENE_A).cancelRequested).toBe(true)

    const settled = studioCinemaReducer(state, {
      type: 'cancel/settled',
      identity: IDENTITY_A,
      run: createTestRun(CINEMA_TEST_SCENE_A, 'run_1', 'cancelled'),
    })
    const record = sceneStateOf(settled, CINEMA_TEST_SCENE_A)
    expect(record.cancelRequested).toBe(false)
    expect(record.runs[0]?.status).toBe('cancelled')
    expect(readStudioCinemaActiveRun(record)).toBeNull()
    expect(record.feedback).toBeNull()

    const failed = studioCinemaReducer(state, {
      type: 'cancel/settled',
      identity: IDENTITY_A,
      code: 'run_cancel_failed',
    })
    expect(sceneStateOf(failed, CINEMA_TEST_SCENE_A).feedback?.code).toBe('run_cancel_failed')
  })

  it('never writes to a scene that has no record for the action identity', () => {
    const base = withScenes(openState(), [createTestScene(CINEMA_TEST_SESSION_ID, CINEMA_TEST_SCENE_A, 0)])
    const untouched = studioCinemaReducer(base, {
      type: 'draft/changed',
      identity: { sessionId: 'session_other', sceneId: CINEMA_TEST_SCENE_A },
      text: 'leak',
    })

    expect(untouched).toBe(base)
    expect(sceneStateOf(untouched, CINEMA_TEST_SCENE_A).draft).toBe('')
  })
})
