import { describe, expect, it } from 'vitest'
import type {
  StudioCreateSceneRunResponse,
  StudioScene,
  StudioSceneMessage,
  StudioSceneRun,
  StudioSceneSnapshot,
} from '../protocol/studio-agent-types'
import { createSceneState, mergeAcceptedRun, mergeSceneSnapshot } from './scene-state'
import { STUDIO_CINEMA_INTERRUPTED_RUN_ERROR, type StudioCinemaSceneIdentity } from './types'

const IDENTITY: StudioCinemaSceneIdentity = { sessionId: 'sess_local_1', sceneId: 'scene_1' }
const SCENE: StudioScene = {
  id: 'scene_1',
  sessionId: 'sess_local_1',
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function user(id: string, text: string, second: number): StudioSceneMessage {
  return {
    id,
    sessionId: IDENTITY.sessionId,
    sceneId: IDENTITY.sceneId,
    role: 'user',
    text,
    createdAt: `2026-01-01T00:00:0${second}.000Z`,
    updatedAt: `2026-01-01T00:00:0${second}.000Z`,
  }
}

function run(id: string, status: StudioSceneRun['status'], second = 0): StudioSceneRun {
  return {
    id,
    sessionId: IDENTITY.sessionId,
    sceneId: IDENTITY.sceneId,
    status,
    inputText: 'draw',
    activeAgent: 'builder',
    createdAt: `2026-01-01T00:00:0${second}.000Z`,
  }
}

function snapshot(overrides: Partial<StudioSceneSnapshot> = {}): StudioSceneSnapshot {
  return {
    scene: { ...SCENE },
    messages: [],
    runs: [],
    renders: [],
    ...overrides,
  }
}

/** A scene that was admitted and is streaming on the previous server binding. */
function runningSceneOnOldBinding() {
  const base = createSceneState(IDENTITY, SCENE)
  return {
    ...base,
    serverBindingId: 'sess_srv_old:scene_srv_old',
    messages: [user('A', 'A', 0), user('B', 'B', 1), user('C', 'C', 2), user('D', 'D', 3)],
    runs: [run('run_terminal', 'completed'), run('run_active', 'running')],
    draft: '',
    draftVersion: 4,
    submitting: true,
    pendingUserMessageId: 'D',
    submittedDraftVersion: 4,
    submittedDraftText: 'A B C D',
  }
}

function acceptedResponse(
  overrides: Partial<StudioCreateSceneRunResponse>,
): StudioCreateSceneRunResponse {
  return {
    scene: { ...SCENE },
    messages: [],
    runs: [],
    renders: [],
    serverBindingId: 'sess_srv_new:scene_srv_new',
    incremental: true,
    run: run('run_new', 'running'),
    ...overrides,
  }
}

describe('Scene snapshot binding rebase', () => {
  it('clears the old binding active Run, re-enables a captured draft and keeps A B C D', () => {
    const scene = runningSceneOnOldBinding()

    const merged = mergeSceneSnapshot(scene, snapshot({
      serverBindingId: 'sess_srv_new:scene_srv_new',
      // The recreated server can only return the thinner records it owns.
      messages: [user('A', 'A', 0), user('B', 'B', 1)],
      runs: [],
    }))

    expect(merged.serverBindingId).toBe('sess_srv_new:scene_srv_new')
    expect(merged.messages.map((message) => message.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(merged.runs.find((candidate) => candidate.id === 'run_active')).toMatchObject({
      status: 'failed',
      error: STUDIO_CINEMA_INTERRUPTED_RUN_ERROR,
    })
    // A terminal record is history, not a casualty of the rebind.
    expect(merged.runs.find((candidate) => candidate.id === 'run_terminal')?.status).toBe('completed')
    // Admission state belonged to the old binding; the captured draft comes back so it can be sent.
    expect(merged.submitting).toBe(false)
    expect(merged.pendingUserMessageId).toBeNull()
    expect(merged.submittedDraftVersion).toBeNull()
    expect(merged.draft).toBe('A B C D')
    expect(merged.feedback).toEqual({ code: 'run_interrupted', needsReconciliation: false })
  })

  it('keeps a new-binding Run that already arrived by SSE when the rebase snapshot names it', () => {
    const scene = {
      ...runningSceneOnOldBinding(),
      // The new Run's `run.updated` event landed before the snapshot that admits the new binding.
      runs: [
        run('run_terminal', 'completed'),
        run('run_old_active', 'running'),
        run('run_new', 'running'),
      ],
    }

    const merged = mergeSceneSnapshot(scene, snapshot({
      serverBindingId: 'sess_srv_new:scene_srv_new',
      runs: [run('run_new', 'running')],
    }))

    expect(merged.runs.find((candidate) => candidate.id === 'run_old_active')?.status).toBe('failed')
    expect(merged.runs.find((candidate) => candidate.id === 'run_new')?.status).toBe('running')
  })

  it('keeps the top-level accepted Run running when the response carries no runs', () => {
    const scene = {
      ...runningSceneOnOldBinding(),
      runs: [run('run_terminal', 'completed'), run('run_old_active', 'running')],
    }

    const merged = mergeAcceptedRun(scene, acceptedResponse({
      runs: [],
      run: run('run_new', 'running'),
    }))

    expect(merged.runs.find((candidate) => candidate.id === 'run_old_active')?.status).toBe('failed')
    expect(merged.runs.find((candidate) => candidate.id === 'run_new')?.status).toBe('running')
  })

  it('keeps an active Run alive when a same-binding snapshot omits it', () => {
    const scene = runningSceneOnOldBinding()

    const merged = mergeSceneSnapshot(scene, snapshot({
      serverBindingId: 'sess_srv_old:scene_srv_old',
      messages: [user('A', 'A', 0)],
      runs: [],
    }))

    expect(merged.serverBindingId).toBe('sess_srv_old:scene_srv_old')
    expect(merged.runs.find((candidate) => candidate.id === 'run_active')?.status).toBe('running')
    expect(merged.feedback).toBeNull()
    // Same binding: the snapshot is the authoritative message list. Only the pending admission row is
    // preserved, which is what keeps the in-flight user row from disappearing while its Run lives.
    expect(merged.messages.map((message) => message.id)).toEqual(['A', 'D'])
  })

  it('does not treat a missing binding marker as proof that the binding changed', () => {
    const scene = runningSceneOnOldBinding()

    const merged = mergeSceneSnapshot(scene, snapshot({ messages: [], runs: [] }))

    expect(merged.serverBindingId).toBe('sess_srv_old:scene_srv_old')
    expect(merged.runs.find((candidate) => candidate.id === 'run_active')?.status).toBe('running')
    expect(merged.feedback).toBeNull()
  })
})
