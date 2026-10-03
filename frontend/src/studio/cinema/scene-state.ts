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
  isStudioCinemaTerminalRenderStatus,
  isStudioCinemaTerminalRunStatus,
  type StudioCinemaSceneEvent,
  type StudioCinemaSceneIdentity,
  type StudioCinemaSceneState,
  type StudioCinemaState,
} from './types'

/**
 * Pure Scene state transitions: the helpers the reducer and the controller use to read and
 * update one Scene record. The reducer and its action union live in scene-reducer.ts.
 */

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
