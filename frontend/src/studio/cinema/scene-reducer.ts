/**
 * The Cinema Scene reducer and its action union.
 *
 * The reducer owns exactly one Session and its Scenes; every action names the `(sessionId,
 * sceneId)` it applies to, so a late callback can only ever touch the Scene it captured. Session
 * level actions additionally carry the generation they were produced in, and the reducer drops an
 * action that no longer matches, so a workflow that finished after a Session switch cannot touch the
 * new state. Timestamps arrive in the action (`receivedAt`) because a reducer must not read a clock,
 * and nothing here derives a Run/Render outcome from a connection state: a terminal status changes
 * only through a snapshot, an event or a cancel response.
 *
 * The state-shape helpers (updateScene, mergeSceneSnapshot, applySceneEvent, mergeAcceptedRun,
 * upsertSceneRun, createSceneState) live in scene-state.ts and are imported here.
 */
import type {
  StudioScene,
  StudioSceneRun,
  StudioSceneSnapshot,
  StudioCreateSceneRunResponse,
} from '../protocol/studio-agent-types'
import {
  buildStudioCinemaSceneKey,
  createInitialStudioCinemaState,
  type StudioCinemaFeedback,
  type StudioCinemaFeedbackCode,
  type StudioCinemaInitializationState,
  type StudioCinemaSceneEvent,
  type StudioCinemaSceneIdentity,
  type StudioCinemaRenderRefreshState,
  type StudioCinemaSceneState,
  type StudioCinemaState,
  type StudioCinemaStreamState,
} from './types'
import {
  isStudioCinemaAcceptedRunResponseForIdentity,
  isStudioCinemaSceneRunForIdentity,
  isStudioCinemaSceneSnapshotForIdentity,
} from './scene-response-identity'
import {
  applySceneEvent,
  createSceneState,
  mergeAcceptedRun,
  mergeSceneSnapshot,
  updateScene,
  upsertSceneRun,
} from './scene-state'

export type StudioCinemaAction =
  | { type: 'session/opened'; sessionId: string; generation: number; title: string | null; projectId: string | null }
  | { type: 'session/closed'; generation: number }
  | { type: 'session/index'; generation: number; scenes: StudioScene[] }
  | { type: 'session/feedback'; generation: number; feedback: StudioCinemaFeedback | null }
  | { type: 'session/mutation-pending'; generation: number; pending: boolean }
  | { type: 'initialization/patch'; generation: number; patch: Partial<StudioCinemaInitializationState> }
  | { type: 'scene/selected'; generation: number; sceneId: string | null }
  | { type: 'scene/loading'; identity: StudioCinemaSceneIdentity }
  /** A recovery window opened: the authoritative snapshot is being read again. */
  | { type: 'scene/recovery-started'; identity: StudioCinemaSceneIdentity }
  | { type: 'scene/created'; scene: StudioScene }
  | { type: 'scene/snapshot'; identity: StudioCinemaSceneIdentity; snapshot: StudioSceneSnapshot }
  | { type: 'scene/snapshot-failed'; identity: StudioCinemaSceneIdentity; code: StudioCinemaFeedbackCode }
  | { type: 'scene/event'; identity: StudioCinemaSceneIdentity; event: StudioCinemaSceneEvent; receivedAt: number }
  | {
      type: 'scene/stream-state'
      identity: StudioCinemaSceneIdentity
      state: StudioCinemaStreamState
      attempt: number
    }
  /**
   * The window that produced the last snapshot could not be proven complete (assistant deltas were
   * discarded or the buffer overflowed): the Scene converges at the next checkpoint and does not
   * claim to be in sync.
   */
  | { type: 'scene/convergence-pending'; identity: StudioCinemaSceneIdentity; at: number }
  | { type: 'scene/feedback'; identity: StudioCinemaSceneIdentity; feedback: StudioCinemaFeedback | null }
  /**
   * Render refresh bookkeeping: `active` while a tick is pending or in flight, `paused` when the
   * loop gave up (bounded failures or budget) and waits for an explicit resume. It is a statement
   * about the loop, never about the render outcome.
   */
  | { type: 'scene/render-refresh'; identity: StudioCinemaSceneIdentity; patch: Partial<StudioCinemaRenderRefreshState> }
  | { type: 'draft/changed'; identity: StudioCinemaSceneIdentity; text: string }
  | { type: 'submit/started'; identity: StudioCinemaSceneIdentity }
  | { type: 'submit/accepted'; identity: StudioCinemaSceneIdentity; response: StudioCreateSceneRunResponse }
  | {
      type: 'submit/failed'
      identity: StudioCinemaSceneIdentity
      code: StudioCinemaFeedbackCode
      unknownOutcome: boolean
    }
  | { type: 'cancel/started'; identity: StudioCinemaSceneIdentity }
  | {
      type: 'cancel/settled'
      identity: StudioCinemaSceneIdentity
      /** The Run the cancel was requested for; a settlement for any other Run is never written. */
      targetRunId?: string
      needsReconciliation?: boolean
      run?: StudioSceneRun
      code?: StudioCinemaFeedbackCode
    }

export function studioCinemaReducer(state: StudioCinemaState, action: StudioCinemaAction): StudioCinemaState {
  switch (action.type) {
    case 'session/opened':
      return openSession(state, action)
    case 'session/closed': {
      if (action.generation < state.session.generation) {
        return state
      }
      const initial = createInitialStudioCinemaState()
      return { ...initial, session: { ...initial.session, generation: action.generation } }
    }
    case 'session/index':
      return isCurrentSessionGeneration(state, action.generation) ? withSceneIndex(state, action.scenes) : state
    case 'session/feedback':
      return isCurrentSessionGeneration(state, action.generation) ? { ...state, feedback: action.feedback } : state
    case 'session/mutation-pending':
      return isCurrentSessionGeneration(state, action.generation)
        ? { ...state, sceneMutationPending: action.pending }
        : state
    case 'initialization/patch':
      return isCurrentSessionGeneration(state, action.generation)
        ? { ...state, initialization: { ...state.initialization, ...action.patch } }
        : state
    case 'scene/selected':
      return isCurrentSessionGeneration(state, action.generation) ? { ...state, selectedSceneId: action.sceneId } : state
    case 'scene/loading':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        snapshotStatus: 'loading',
        streamState: 'connecting',
        feedback: null,
      }))
    case 'scene/recovery-started':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        snapshotStatus: 'loading',
        feedback: null,
      }))
    case 'scene/created':
      return withCreatedScene(state, action.scene)
    case 'scene/snapshot':
      // 11C7-A: a payload that is not scoped to the named Scene is refused as a unit.
      if (!isStudioCinemaSceneSnapshotForIdentity(action.identity, action.snapshot)) {
        return state
      }
      return updateScene(state, action.identity, (scene) => mergeSceneSnapshot(scene, action.snapshot))
    case 'scene/snapshot-failed':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        snapshotStatus: 'error',
        feedback: { code: action.code, needsReconciliation: true },
      }))
    case 'scene/event':
      return updateScene(state, action.identity, (scene) =>
        applySceneEvent(scene, action.event, action.receivedAt)
      )
    case 'scene/stream-state':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        streamState: action.state,
        streamAttempt: action.attempt,
      }))
    case 'scene/convergence-pending':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        convergencePending: true,
        resyncedAt: action.at,
        feedback: { code: 'stream_resync', needsReconciliation: false },
      }))
    case 'scene/render-refresh':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        renderRefresh: { ...scene.renderRefresh, ...action.patch },
      }))
    case 'scene/feedback':
      return updateScene(state, action.identity, (scene) => ({ ...scene, feedback: action.feedback }))
    case 'draft/changed':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        draft: action.text,
        draftVersion: scene.draftVersion + 1,
      }))
    case 'submit/started':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        submitting: true,
        submittedDraftVersion: scene.draftVersion,
        needsReconciliation: false,
        feedback: null,
      }))
    case 'submit/accepted':
      // 11C7-A: the snapshot's records and the accepted top-level Run must both be scoped to the Scene.
      if (!isStudioCinemaAcceptedRunResponseForIdentity(action.identity, action.response)) {
        return state
      }
      return updateScene(state, action.identity, (scene) =>
        mergeAcceptedRun(scene, action.response)
      )
    case 'submit/failed':
      return updateScene(state, action.identity, (scene) => ({
        ...scene,
        submitting: false,
        submittedDraftVersion: null,
        needsReconciliation: action.unknownOutcome,
        feedback: { code: action.code, needsReconciliation: action.unknownOutcome },
      }))
    case 'cancel/started':
      return updateScene(state, action.identity, (scene) => ({ ...scene, cancelRequested: true }))
    case 'cancel/settled':
      return updateScene(state, action.identity, (scene) => {
        const next: StudioCinemaSceneState = { ...scene, cancelRequested: false }
        // 11C7-A: a Run of another Scene or Session is never merged into this Scene.
        const usableRun =
          action.run &&
          isStudioCinemaSceneRunForIdentity(action.identity, action.run) &&
          (action.targetRunId === undefined || action.run.id === action.targetRunId)
            ? action.run
            : null
        const applied = usableRun ? upsertSceneRun(next, usableRun) : next
        return action.code
          ? {
              ...applied,
              needsReconciliation: applied.needsReconciliation || action.needsReconciliation === true,
              feedback: { code: action.code, needsReconciliation: action.needsReconciliation === true },
            }
          : applied
      })
    default:
      return state
  }
}

/** A Session level action is applied only while the state still holds the generation it names. */
function isCurrentSessionGeneration(state: StudioCinemaState, generation: number): boolean {
  return state.session.generation === generation
}

function openSession(
  state: StudioCinemaState,
  action: Extract<StudioCinemaAction, { type: 'session/opened' }>,
): StudioCinemaState {
  const sameSession = state.session.id === action.sessionId
  if (!sameSession) {
    // A different Session starts from an empty state: no Scene record, draft or feedback carries over.
    return {
      ...createInitialStudioCinemaState(),
      session: {
        id: action.sessionId,
        generation: action.generation,
        title: action.title,
        projectId: action.projectId,
      },
    }
  }

  return {
    ...state,
    session: {
      id: action.sessionId,
      generation: action.generation,
      title: action.title ?? state.session.title,
      projectId: action.projectId ?? state.session.projectId,
    },
  }
}

/**
 * Full index replacement from a Session snapshot: recovery reads Scenes, it never creates them.
 * Scenes of another Session are refused, and a selection survives only while that exact
 * `(sessionId, sceneId)` is still in the index — the Scene map is keyed by the composite key, so
 * the check is done on the built key rather than on the raw Scene id.
 */
function withSceneIndex(state: StudioCinemaState, scenes: StudioScene[]): StudioCinemaState {
  const sessionId = state.session.id ?? ''
  const ordered = scenes.filter((scene) => scene.sessionId === sessionId).sort(compareSceneOrder)
  const nextScenes: Record<string, StudioCinemaSceneState> = {}
  for (const scene of ordered) {
    const identity = { sessionId, sceneId: scene.id }
    const key = buildStudioCinemaSceneKey(identity)
    const existing = state.scenes[key]
    nextScenes[key] = existing ? { ...existing, scene } : createSceneState(identity, scene)
  }

  const selectionKey =
    state.selectedSceneId === null
      ? null
      : buildStudioCinemaSceneKey({ sessionId, sceneId: state.selectedSceneId })
  const selectedSceneId =
    selectionKey !== null && nextScenes[selectionKey] !== undefined ? state.selectedSceneId : null

  return { ...state, sceneOrder: ordered.map((scene) => scene.id), scenes: nextScenes, selectedSceneId }
}

function withCreatedScene(state: StudioCinemaState, scene: StudioScene): StudioCinemaState {
  if (scene.sessionId !== state.session.id) {
    // A creation that answered after a Session switch belongs to no record here.
    return state
  }

  const identity = { sessionId: state.session.id ?? '', sceneId: scene.id }
  const key = buildStudioCinemaSceneKey(identity)
  const existing = state.scenes[key]
  const sceneOrder = state.sceneOrder.includes(scene.id)
    ? state.sceneOrder
    : [...state.sceneOrder, scene.id]

  return {
    ...state,
    sceneOrder,
    scenes: {
      ...state.scenes,
      [key]: existing ? { ...existing, scene } : createSceneState(identity, scene),
    },
  }
}

function compareSceneOrder(left: StudioScene, right: StudioScene): number {
  if (left.position !== right.position) {
    return left.position - right.position
  }
  return left.id.localeCompare(right.id)
}