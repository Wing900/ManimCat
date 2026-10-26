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
    pendingUserMessageId: null,
    runs: [],
    renders: [],
    draft: '',
    draftVersion: 0,
    submitting: false,
    submittedDraftVersion: null,
    submittedDraftText: null,
    cancelRequested: false,
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
 * authoritative read resolves a pending convergence: the read is the convergence checkpoint, re-armed
 * by the controller only when the window that produced this snapshot could not be proven complete.
 */
export function mergeSceneSnapshot(
  scene: StudioCinemaSceneState,
  snapshot: StudioSceneSnapshot,
): StudioCinemaSceneState {
  // A snapshot may have been started while a newer admission was in flight. Preserve only that
  // admission's optimistic user row (and its id, so failure rollback can remove the right row),
  // leaving every other row authoritative from the snapshot and never reordering real history.
  const pending = scene.submitting && scene.pendingUserMessageId
    ? scene.messages.find(
        (message) => message.id === scene.pendingUserMessageId && message.role === 'user',
      )
    : undefined
  const messages = [...snapshot.messages]
  if (pending && !messages.some((message) => message.id === pending.id)) {
    messages.push(pending)
  }

  let next: StudioCinemaSceneState = {
    ...scene,
    messages,
    pendingUserMessageId: pending ? pending.id : null,
    snapshotStatus: 'ready',
    feedback: null,
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
 * composer was cleared at submission. Preserve text typed while admission was pending.
 */
export function mergeAcceptedRun(
  scene: StudioCinemaSceneState,
  response: StudioCreateSceneRunResponse,
): StudioCinemaSceneState {
  // Preserve history and SSE text that may have arrived before the admission response.
  const messages = response.incremental
    ? [...new Map([...response.messages, ...scene.messages.filter(message => message.id !== scene.pendingUserMessageId)]
      .map(message => [message.id, message])).values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    : response.messages
  // The accepted server row replaces the optimistic row exactly once. Clear the admission markers
  // before the snapshot merge so its preservation rule cannot reinject the optimistic row.
  const admitted = {
    ...scene,
    submitting: false,
    pendingUserMessageId: null,
  }
  const snapshot = mergeSceneSnapshot(admitted, { ...response, messages })
  // P3: the response's top-level `run` is the accepted Run. Without this the Scene has no active
  // Run until the next SSE or snapshot whenever `runs` does not already carry it. `upsertSceneRun`
  // remains the single authoritative merge rule (one entry per id, no terminal downgrade).
  const merged = response.run ? upsertSceneRun(snapshot, response.run) : snapshot
  const keepDraft = scene.draftVersion !== scene.submittedDraftVersion

  return {
    ...merged,
    submitting: false,
    submittedDraftVersion: null,
    submittedDraftText: null,
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
      return appendAssistantText(scene, event.messageId, event.text, receivedAt, event.partId)
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
 * A part-scoped event carries the complete text of one stable part, so the part is upserted by id and
 * its text replaced: replaying the same event is idempotent and a snapshot keeps the first position.
 * A Legacy event has no part id and keeps append semantics, but only onto a trailing synthetic text
 * part for this message; text after a Tool starts a new synthetic part, so segments never merge
 * across an intervening Tool call.
 */
function appendAssistantText(
  scene: StudioCinemaSceneState,
  messageId: string,
  text: string,
  receivedAt: number,
  partId?: string,
): StudioCinemaSceneState {
  const ensured = ensureAssistantMessage(scene, messageId, receivedAt)
  const parts: StudioScenePart[] = [...ensured.message.parts]

  if (partId !== undefined) {
    const partIndex = parts.findIndex((part) => part.type === 'text' && part.id === partId)
    parts[partIndex < 0 ? parts.length : partIndex] = {
      id: partId,
      messageId,
      sessionId: ensured.message.sessionId,
      type: 'text',
      text,
    }
  } else {
    const legacyPartId = `stream:text:${messageId}`
    const trailing = parts[parts.length - 1]
    const trailingIsSyntheticText = trailing?.type === 'text' && (
      trailing.id === legacyPartId || trailing.id.startsWith(`${legacyPartId}:`)
    )
    if (trailingIsSyntheticText) {
      parts[parts.length - 1] = { ...trailing, text: trailing.text + text }
    } else {
      parts.push({
        id: `${legacyPartId}:${parts.length}`,
        messageId,
        sessionId: ensured.message.sessionId,
        type: 'text',
        text,
      })
    }
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
