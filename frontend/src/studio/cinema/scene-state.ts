import type {
  StudioScene,
  StudioSceneAssistantMessage,
  StudioSceneMessage,
  StudioScenePart,
  StudioSceneRender,
  StudioSceneRun,
  StudioSceneSnapshot,
  StudioSceneToolPart,
  StudioCreateSceneRunResponse,
} from '../protocol/studio-agent-types'
import {
  buildStudioCinemaSceneKey,
  createInitialStudioCinemaRenderRefreshState,
  createInitialStudioCinemaState,
  isStudioCinemaTerminalRenderStatus,
  isStudioCinemaTerminalRunStatus,
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

/**
 * Pure Scene state transitions.
 *
 * The reducer owns exactly one Session and its Scenes; every action names the `(sessionId,
 * sceneId)` it applies to, so a late callback can only ever touch the Scene it captured. Session
 * level actions additionally carry the generation they were produced in (or, for a Session record,
 * the identity of the Scene they name), and the reducer drops an action that no longer matches, so
 * a workflow that finished after a Session switch cannot touch the new state. Timestamps arrive in
 * the action (`receivedAt`) because a reducer must not read a clock, and nothing here derives a
 * Run/Render outcome from a connection state: a terminal status changes only through a snapshot, an
 * event or a cancel response.
 */
import {
  isStudioCinemaAcceptedRunResponseForIdentity,
  isStudioCinemaSceneRunForIdentity,
  isStudioCinemaSceneSnapshotForIdentity,
} from './scene-response-identity'

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

export function updateScene(
  state: StudioCinemaState,
  identity: StudioCinemaSceneIdentity,
  update: (scene: StudioCinemaSceneState) => StudioCinemaSceneState,
): StudioCinemaState {
  const key = buildStudioCinemaSceneKey(identity)
  const current = state.scenes[key]
  if (!current) {
    return state
  }
  return { ...state, scenes: { ...state.scenes, [key]: update(current) } }
}

export function selectSceneState(
  state: StudioCinemaState,
  identity: StudioCinemaSceneIdentity,
): StudioCinemaSceneState | null {
  return state.scenes[buildStudioCinemaSceneKey(identity)] ?? null
}

export function createSceneState(
  identity: StudioCinemaSceneIdentity,
  scene: StudioScene,
): StudioCinemaSceneState {
  return {
    identity,
    scene,
    messages: [],
    runs: [],
    renders: [],
    draft: '',
    draftVersion: 0,
    submitting: false,
    submittedDraftVersion: null,
    cancelRequested: false,
    needsReconciliation: false,
    snapshotStatus: 'idle',
    streamState: 'idle',
    streamAttempt: 0,
    resyncedAt: null,
    convergencePending: false,
    renderRefresh: createInitialStudioCinemaRenderRefreshState(),
    feedback: null,
  }
}

function compareSceneOrder(left: StudioScene, right: StudioScene): number {
  if (left.position !== right.position) {
    return left.position - right.position
  }
  return left.id.localeCompare(right.id)
}

/**
 * Snapshot merge. The conversation is replaced by the authoritative list, a Run/Render that already
 * reached a terminal status is not downgraded by an older active record in the snapshot, and an
 * authoritative read resolves both the unknown-outcome flag and a pending convergence: the read is
 * the convergence checkpoint, so those two states are cleared here and re-armed by the controller
 * only when the window that produced this snapshot could not be proven complete.
 */
export function mergeSceneSnapshot(
  scene: StudioCinemaSceneState,
  snapshot: StudioSceneSnapshot,
): StudioCinemaSceneState {
  let next: StudioCinemaSceneState = {
    ...scene,
    messages: [...snapshot.messages],
    snapshotStatus: 'ready',
    feedback: null,
    needsReconciliation: false,
    convergencePending: false,
    scene: snapshot.scene,
  }

  for (const run of snapshot.runs) {
    next = upsertSceneRun(next, run)
  }
  for (const render of snapshot.renders) {
    next = upsertSceneRender(next, render)
  }

  return next
}

/**
 * Accepted submit response: the same projection as the Scene snapshot plus the accepted Run. The
 * draft is cleared only when it is still the exact version the submit captured, so text typed while
 * waiting stays in the composer.
 */
export function mergeAcceptedRun(
  scene: StudioCinemaSceneState,
  response: StudioCreateSceneRunResponse,
): StudioCinemaSceneState {
  const snapshot = mergeSceneSnapshot(scene, response)
  // P3: the response's top-level `run` is the accepted Run. Without this the Scene has no active
  // Run until the next SSE or snapshot whenever `runs` does not already carry it. `upsertSceneRun`
  // remains the single authoritative merge rule (one entry per id, no terminal downgrade).
  const merged = response.run ? upsertSceneRun(snapshot, response.run) : snapshot
  const keepDraft = scene.draftVersion !== scene.submittedDraftVersion

  return {
    ...merged,
    submitting: false,
    submittedDraftVersion: null,
    draft: keepDraft ? scene.draft : '',
  }
}

export function upsertSceneRun(scene: StudioCinemaSceneState, run: StudioSceneRun): StudioCinemaSceneState {
  const index = scene.runs.findIndex((candidate) => candidate.id === run.id)
  if (index < 0) {
    return { ...scene, runs: [...scene.runs, run] }
  }

  const existing = scene.runs[index]
  if (!existing || !shouldReplaceRecord(existing.status, run.status, isStudioCinemaTerminalRunStatus)) {
    return scene
  }

  const runs = [...scene.runs]
  runs[index] = run
  return { ...scene, runs }
}

export function upsertSceneRender(
  scene: StudioCinemaSceneState,
  render: StudioSceneRender,
): StudioCinemaSceneState {
  const index = scene.renders.findIndex((candidate) => candidate.id === render.id)
  if (index < 0) {
    return { ...scene, renders: [...scene.renders, render] }
  }

  const existing = scene.renders[index]
  if (!existing || !shouldReplaceRecord(existing.status, render.status, isStudioCinemaTerminalRenderStatus)) {
    return scene
  }

  const renders = [...scene.renders]
  renders[index] = render
  return { ...scene, renders }
}

/**
 * Terminal stickiness: once a record reached a terminal status, a late `pending`/`running` update
 * (or an older active snapshot row) is ignored. Any other transition replaces the stored record.
 */
function shouldReplaceRecord<TStatus extends string>(
  existingStatus: TStatus,
  incomingStatus: TStatus,
  isTerminal: (status: TStatus) => boolean,
): boolean {
  if (isTerminal(existingStatus) && !isTerminal(incomingStatus)) {
    return false
  }
  return true
}

export function applySceneEvent(
  scene: StudioCinemaSceneState,
  event: StudioCinemaSceneEvent,
  receivedAt: number,
): StudioCinemaSceneState {
  switch (event.kind) {
    case 'connection':
      return scene
    case 'run-updated':
      return upsertSceneRun(scene, event.run)
    case 'render-updated':
      return upsertSceneRender(scene, event.render)
    case 'assistant-text':
      return appendAssistantText(scene, event.messageId, event.text, receivedAt)
    case 'tool-input-start':
      return upsertToolPart(scene, event, receivedAt)
    case 'tool-call':
      return upsertToolPart(scene, event, receivedAt)
    case 'tool-result':
      return upsertToolPart(scene, event, receivedAt)
    default:
      return scene
  }
}

/**
 * Deltas are appended in arrival order and are never deduplicated by content: two identical chunks
 * are two chunks, and only the server snapshot replaces the accumulated text.
 */
function appendAssistantText(
  scene: StudioCinemaSceneState,
  messageId: string,
  text: string,
  receivedAt: number,
): StudioCinemaSceneState {
  const ensured = ensureAssistantMessage(scene, messageId, receivedAt)
  const partId = `stream:text:${messageId}`
  const partIndex = ensured.message.parts.findIndex((part) => part.type === 'text' && part.id === partId)
  const parts: StudioScenePart[] = [...ensured.message.parts]
  const existing = partIndex < 0 ? null : parts[partIndex]
  parts[partIndex < 0 ? parts.length : partIndex] = {
    id: partId,
    messageId,
    sessionId: ensured.message.sessionId,
    type: 'text',
    text: `${existing && existing.type === 'text' ? existing.text : ''}${text}`,
  }

  const messages = [...ensured.messages]
  messages[ensured.index] = {
    ...ensured.message,
    parts,
    updatedAt: new Date(receivedAt).toISOString(),
  }
  return { ...scene, messages }
}

function upsertToolPart(
  scene: StudioCinemaSceneState,
  event: Extract<StudioCinemaSceneEvent, { kind: 'tool-input-start' | 'tool-call' | 'tool-result' }>,
  receivedAt: number,
): StudioCinemaSceneState {
  const ensured = ensureAssistantMessage(scene, event.messageId, receivedAt)
  const existingPart = ensured.message.parts.find(
    (part): part is StudioSceneToolPart => part.type === 'tool' && part.callId === event.callId,
  )
  const partIndex = existingPart ? ensured.message.parts.indexOf(existingPart) : -1
  const time = { start: existingPart?.state.time?.start ?? receivedAt, end: receivedAt }

  const part: StudioSceneToolPart = existingPart
    ? { ...existingPart, tool: event.toolName, state: nextToolState(existingPart, event, time) }
    : {
        id: `stream:tool:${event.messageId}:${event.callId}`,
        messageId: event.messageId,
        sessionId: ensured.message.sessionId,
        type: 'tool',
        tool: event.toolName,
        callId: event.callId,
        state: nextToolState(null, event, time),
      }

  const parts: StudioScenePart[] = [...ensured.message.parts]
  parts[partIndex < 0 ? parts.length : partIndex] = part

  const messages = [...ensured.messages]
  messages[ensured.index] = {
    ...ensured.message,
    parts,
    updatedAt: new Date(receivedAt).toISOString(),
  }
  return { ...scene, messages }
}

/**
 * Public Tool status only. A failed result keeps its status and loses the result text entirely, so
 * no internal diagnostic can enter the Scene store even if a frame ever carried one.
 */
function nextToolState(
  existing: StudioSceneToolPart | null,
  event: Extract<StudioCinemaSceneEvent, { kind: 'tool-input-start' | 'tool-call' | 'tool-result' }>,
  time: { start: number; end: number },
): StudioSceneToolPart['state'] {
  if (event.kind !== 'tool-result') {
    return existing?.state ?? { status: 'pending', time }
  }

  if (event.status === 'failed') {
    return {
      status: 'error',
      time,
      ...(event.title === undefined ? {} : { title: event.title }),
      ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
      ...(event.attachments === undefined ? {} : { attachments: event.attachments }),
    }
  }

  return {
    status: 'completed',
    title: event.title ?? existing?.state.title ?? event.toolName,
    ...(event.output === undefined ? {} : { output: event.output }),
    time,
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    ...(event.attachments === undefined ? {} : { attachments: event.attachments }),
  }
}

/**
 * Finds the assistant message a streaming event belongs to, creating a placeholder when the event
 * arrives before the authoritative snapshot. The placeholder carries synthetic part ids and is
 * replaced wholesale on the next snapshot read. A non-assistant record that happens to share the id
 * is replaced rather than cast, so no streaming part is ever attached to a user message.
 */
function ensureAssistantMessage(
  scene: StudioCinemaSceneState,
  messageId: string,
  receivedAt: number,
): { messages: StudioSceneMessage[]; message: StudioSceneAssistantMessage; index: number } {
  const index = scene.messages.findIndex((message) => message.id === messageId)
  const existing = index < 0 ? undefined : scene.messages[index]
  if (existing && existing.role === 'assistant') {
    return { messages: scene.messages, message: existing, index }
  }

  const placeholder = createStreamingAssistantMessage(scene, messageId, receivedAt)
  if (index < 0) {
    return { messages: [...scene.messages, placeholder], message: placeholder, index: scene.messages.length }
  }

  const messages = [...scene.messages]
  messages[index] = placeholder
  return { messages, message: placeholder, index }
}

function createStreamingAssistantMessage(
  scene: StudioCinemaSceneState,
  messageId: string,
  receivedAt: number,
): StudioSceneAssistantMessage {
  const timestamp = new Date(receivedAt).toISOString()
  return {
    id: messageId,
    sessionId: scene.identity.sessionId,
    sceneId: scene.identity.sceneId,
    role: 'assistant',
    agent: 'builder',
    parts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
