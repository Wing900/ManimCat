import type { StudioExternalEvent } from '../events/studio-event-adapter'
import { projectStudioSceneToolPresentation, readStudioSceneToolPresentationStatus } from './scene-tool-presentation'
import { readStudioPublicMediaLocator } from '../render/studio-public-media-locator'
import type {
  StudioAgentType,
  StudioFileAttachment,
  StudioMessage,
  StudioMessagePart,
  StudioRender,
  StudioRun,
  StudioScene,
  StudioSceneSnapshot,
  StudioSession,
  StudioSessionSnapshot,
  StudioTokenUsage,
  StudioToolState
} from '../domain/types'

export type PublicStudioSession = Omit<StudioSession, 'ownerId' | 'directory' | 'parentSessionId'>
export type PublicStudioRun = Omit<StudioRun, 'ownerId'>
export type PublicStudioRender = Omit<StudioRender, 'ownerId'>
/** `sourcePath` is server-private: the public Scene never carries it. */
export type PublicStudioScene = Omit<StudioScene, 'ownerId' | 'sourcePath'>

export interface PublicStudioSnapshot {
  session: PublicStudioSession
  messages: StudioSessionSnapshot['messages']
  runs: PublicStudioRun[]
  renders: PublicStudioRender[]
  scenes: PublicStudioScene[]
}

export function toPublicStudioSession(session: StudioSession): PublicStudioSession {
  const { ownerId: _ownerId, directory: _directory, parentSessionId: _parentSessionId, ...publicSession } = session
  return publicSession
}

export function toPublicStudioRun(run: StudioRun): PublicStudioRun {
  const { ownerId: _ownerId, ...publicRun } = run
  return publicRun
}

export function toPublicStudioRender(render: StudioRender): PublicStudioRender {
  const { ownerId: _ownerId, ...publicRender } = render
  return publicRender
}

export function toPublicStudioScene(scene: StudioScene): PublicStudioScene {
  const { ownerId: _ownerId, sourcePath: _sourcePath, ...publicScene } = scene
  return publicScene
}

export function toPublicStudioSnapshot(snapshot: StudioSessionSnapshot): PublicStudioSnapshot {
  return {
    session: toPublicStudioSession(snapshot.session),
    messages: snapshot.messages,
    runs: snapshot.runs.map(toPublicStudioRun),
    renders: snapshot.renders.map(toPublicStudioRender),
    scenes: snapshot.scenes.map(toPublicStudioScene),
  }
}

/* ------------------------------------------------------------------------------------------------
 * Scene public projection
 *
 * A Scene response is the end-user-facing read model, so it is built from an explicit whitelist of
 * public fields instead of by deleting one private field from a server record. Everything that can
 * carry server state — the internal failure text, the private source path, arbitrary Tool metadata,
 * raw static diagnostics (replaced by a public count summary), model-supplied Tool input, absolute
 * filesystem paths — is either absent from these types or dropped by the converters. The legacy
 * Session DTOs and the Session SSE stream keep their existing shapes and are not routed through this
 * projection.
 * ---------------------------------------------------------------------------------------------- */

export interface PublicStudioSceneAttachment {
  kind: 'file'
  /** Relative workspace path or public media URI (`data:`/`http(s):`); never a private absolute path. */
  path: string
  name?: string
  mimeType?: string
}

export interface PublicStudioSceneRun {
  id: string
  sessionId: string
  sceneId?: string
  status: StudioRun['status']
  inputText: string
  activeAgent: StudioRun['activeAgent']
  createdAt: string
  completedAt?: string
  tokenUsage?: StudioTokenUsage
}

export interface PublicStudioSceneRender {
  id: string
  sessionId: string
  sceneId?: string
  runId?: string
  kind: StudioRender['kind']
  title: string
  status: StudioRender['status']
  concept: string
  outputMode: StudioRender['outputMode']
  quality?: StudioRender['quality']
  jobId?: string
  /** Playable public media only; see `toPublicStudioSceneAttachments`. */
  attachments?: PublicStudioSceneAttachment[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * Public Tool state. `input`, `raw` and `error` are deliberately absent: the model-supplied
 * argument echo and the internal failure text stay server-side for a Scene read. The title/output
 * pair is decided by `projectStudioSceneToolPresentation`, so a failed Tool publishes no result
 * text and a completed static check publishes counts instead of raw diagnostics.
 */
export interface PublicStudioSceneToolState {
  status: StudioToolState['status']
  title?: string
  output?: string
  time?: { start: number; end?: number }
  attachments?: PublicStudioSceneAttachment[]
  metadata?: Record<string, unknown>
}

export interface PublicStudioSceneTextPart {
  id: string
  messageId: string
  sessionId: string
  type: 'text'
  text: string
  time?: { start: number; end?: number }
}

export interface PublicStudioSceneReasoningPart {
  id: string
  messageId: string
  sessionId: string
  type: 'reasoning'
  text: string
  time?: { start: number; end?: number }
}

export interface PublicStudioSceneToolPart {
  id: string
  messageId: string
  sessionId: string
  type: 'tool'
  tool: string
  callId: string
  state: PublicStudioSceneToolState
  metadata?: Record<string, unknown>
}

export type PublicStudioScenePart =
  | PublicStudioSceneTextPart
  | PublicStudioSceneReasoningPart
  | PublicStudioSceneToolPart

export interface PublicStudioSceneUserMessage {
  id: string
  sessionId: string
  sceneId?: string
  role: 'user'
  text: string
  createdAt: string
  updatedAt: string
}

export interface PublicStudioSceneAssistantMessage {
  id: string
  sessionId: string
  sceneId?: string
  role: 'assistant'
  agent: StudioAgentType
  parts: PublicStudioScenePart[]
  summary?: string
  createdAt: string
  updatedAt: string
}

export type PublicStudioSceneMessage = PublicStudioSceneUserMessage | PublicStudioSceneAssistantMessage

export interface PublicStudioSceneSnapshot {
  scene: PublicStudioScene
  messages: PublicStudioSceneMessage[]
  runs: PublicStudioSceneRun[]
  renders: PublicStudioSceneRender[]
}

/**
 * Metadata keys a Scene read may expose. The list is deliberately closed: a key that is not here
 * never crosses the boundary, so a new internal field cannot leak by accident. `diagnostics`
 * (raw checker output), `error`, `sourcePath`, `workspaceDirectory`, `allowedRoots` and every
 * model-supplied `input`/`raw` bag are absent on purpose.
 */
const PUBLIC_STUDIO_SCENE_METADATA_KEYS: ReadonlySet<string> = new Set([
  'path',
  'bytes',
  'replacements',
  'patchCount',
  'truncated',
  'renderId',
  'jobId',
  'outputMode',
  'quality',
  'studioKind',
  'kind',
  'diagnosticCount',
  'imageCount',
  'scriptPath',
  'imagePaths',
  'matchCount',
  'entryCount',
  'pattern',
  'basePath',
  'status',
  'source',
  'query',
  'symbols',
  'cached',
])

/** Longest public attachment name accepted; a name is display text, never a path. */
const PUBLIC_STUDIO_SCENE_NAME_MAX_LENGTH = 128

/**
 * True when a string may leave the server as a *safe* value: a `data:`/`http(s):` media URI or a
 * relative workspace path. Used for whitelisted metadata values only — a media locator goes through
 * `readStudioPublicMediaLocator`, which is strictly narrower. Absolute, drive-qualified, UNC,
 * null-byte and `..`-bearing values are refused, so a private filesystem path can never be handed
 * to a browser.
 */
export function isPublicStudioSceneLocator(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\0')) {
    return false
  }
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) {
    return true
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[A-Za-z]:/.test(trimmed)) {
    return false
  }
  return !trimmed.split(/[\\/]+/).includes('..')
}

/**
 * Public metadata projection: whitelisted keys, public scalar values only, arrays flattened to
 * public scalars. An empty result is reported as `undefined` so the field disappears from the wire
 * instead of becoming an empty object.
 */
export function toPublicStudioSceneMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined
  }

  const projected: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!PUBLIC_STUDIO_SCENE_METADATA_KEYS.has(key)) {
      continue
    }
    const publicValue = readPublicStudioSceneValue(value)
    if (publicValue !== undefined) {
      projected[key] = publicValue
    }
  }

  return Object.keys(projected).length ? projected : undefined
}

function readPublicStudioSceneValue(
  value: unknown
): string | number | boolean | Array<string | number | boolean> | undefined {
  if (typeof value === 'string') {
    return isPublicStudioSceneLocator(value) ? value : undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (!Array.isArray(value)) {
    return undefined
  }

  const items: Array<string | number | boolean> = []
  for (const item of value) {
    if (typeof item === 'number' || typeof item === 'boolean') {
      items.push(item)
      continue
    }
    if (typeof item === 'string' && isPublicStudioSceneLocator(item)) {
      items.push(item)
    }
  }
  return items.length ? items : undefined
}

function readPublicStudioSceneName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const name = value.trim()
  if (!name || name.length > PUBLIC_STUDIO_SCENE_NAME_MAX_LENGTH) {
    return undefined
  }
  return /[\\/]/.test(name) ? undefined : name
}

/** One public attachment, or `undefined` when its locator may not leave the server. */
export function toPublicStudioSceneAttachment(
  attachment: StudioFileAttachment | undefined
): PublicStudioSceneAttachment | undefined {
  if (!attachment || attachment.kind !== 'file' || typeof attachment.path !== 'string') {
    return undefined
  }

  // The media policy, not the "safe string" rule: only a `data:` URI, an `http(s)` URL or a
  // same-origin `/videos/<file>` / `/images/<file>` path is a browser-loadable locator. A workspace
  // relative path is *not* upgraded into one.
  const locator = readStudioPublicMediaLocator(attachment.path)
  if (!locator) {
    return undefined
  }

  const name = readPublicStudioSceneName(attachment.name)
  const claimedMimeType =
    typeof attachment.mimeType === 'string' && attachment.mimeType.trim() ? attachment.mimeType.trim() : undefined
  // For a same-origin locator the directory/extension table decides the media type, so a mismatched
  // claim can never travel with it; a `data:`/`http` locator keeps the claim it declared.
  const mimeType = locator.mimeType ?? claimedMimeType

  return {
    kind: 'file',
    path: locator.locator,
    ...(name ? { name } : {}),
    ...(mimeType ? { mimeType } : {})
  }
}

export function toPublicStudioSceneAttachments(
  attachments: readonly StudioFileAttachment[] | undefined
): PublicStudioSceneAttachment[] | undefined {
  if (!attachments?.length) {
    return undefined
  }

  const projected: PublicStudioSceneAttachment[] = []
  for (const attachment of attachments) {
    const publicAttachment = toPublicStudioSceneAttachment(attachment)
    if (publicAttachment) {
      projected.push(publicAttachment)
    }
  }
  return projected.length ? projected : undefined
}

/** Scene-level Run: an explicit whitelist. No `ownerId`, no `error`, no free-form metadata. */
export function toPublicStudioSceneRun(run: StudioRun): PublicStudioSceneRun {
  return {
    id: run.id,
    sessionId: run.sessionId,
    ...(run.sceneId ? { sceneId: run.sceneId } : {}),
    status: run.status,
    inputText: run.inputText,
    activeAgent: run.activeAgent,
    createdAt: run.createdAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.tokenUsage ? { tokenUsage: run.tokenUsage } : {}),
  }
}

/** Scene-level render: public media and whitelisted metadata only; no private source path. */
export function toPublicStudioSceneRender(render: StudioRender): PublicStudioSceneRender {
  const attachments = toPublicStudioSceneAttachments(render.attachments)
  const metadata = toPublicStudioSceneMetadata(render.metadata)

  return {
    id: render.id,
    sessionId: render.sessionId,
    ...(render.sceneId ? { sceneId: render.sceneId } : {}),
    ...(render.runId ? { runId: render.runId } : {}),
    kind: render.kind,
    title: render.title,
    status: render.status,
    concept: render.concept,
    outputMode: render.outputMode,
    ...(render.quality ? { quality: render.quality } : {}),
    ...(render.jobId ? { jobId: render.jobId } : {}),
    ...(attachments ? { attachments } : {}),
    ...(metadata ? { metadata } : {}),
    createdAt: render.createdAt,
    updatedAt: render.updatedAt,
  }
}

export function toPublicStudioSceneToolState(
  state: StudioToolState,
  tool: string
): PublicStudioSceneToolState {
  if (state.status === 'pending') {
    return { status: 'pending' }
  }

  const time = { ...state.time }
  const presentation = projectStudioSceneToolPresentation({
    tool,
    status: state.status,
    title: state.status === 'error' ? undefined : state.title,
    output: state.status === 'completed' ? state.output : undefined,
    metadata: state.metadata
  })
  const metadata = toPublicStudioSceneMetadata(presentation.metadata)

  if (state.status === 'running') {
    return {
      status: 'running',
      time,
      ...(typeof presentation.title === 'string' && presentation.title
        ? { title: presentation.title }
        : {}),
      ...(metadata ? { metadata } : {}),
    }
  }

  if (state.status === 'completed') {
    const attachments = toPublicStudioSceneAttachments(state.attachments)
    return {
      status: 'completed',
      title: state.title,
      ...(typeof presentation.output === 'string' ? { output: presentation.output } : {}),
      time,
      ...(attachments ? { attachments } : {}),
      ...(metadata ? { metadata } : {}),
    }
  }

  // A failed Tool keeps its public status; the presentation projection has already dropped the
  // internal result text, so the failure message cannot cross this boundary.
  return {
    status: 'error',
    time,
    ...(metadata ? { metadata } : {}),
  }
}

export function toPublicStudioScenePart(part: StudioMessagePart): PublicStudioScenePart {
  if (part.type === 'tool') {
    const metadata = toPublicStudioSceneMetadata(part.metadata)
    return {
      id: part.id,
      messageId: part.messageId,
      sessionId: part.sessionId,
      type: 'tool',
      tool: part.tool,
      callId: part.callId,
      state: toPublicStudioSceneToolState(part.state, part.tool),
      ...(metadata ? { metadata } : {}),
    }
  }

  return {
    id: part.id,
    messageId: part.messageId,
    sessionId: part.sessionId,
    type: part.type,
    text: part.text,
    ...(part.time ? { time: { ...part.time } } : {}),
  }
}

export function toPublicStudioSceneMessage(message: StudioMessage): PublicStudioSceneMessage {
  const sceneId = message.sceneId ? { sceneId: message.sceneId } : {}

  if (message.role !== 'assistant') {
    return {
      id: message.id,
      sessionId: message.sessionId,
      ...sceneId,
      role: 'user',
      text: message.text,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    }
  }

  return {
    id: message.id,
    sessionId: message.sessionId,
    ...sceneId,
    role: 'assistant',
    agent: message.agent,
    parts: message.parts.map(toPublicStudioScenePart),
    ...(message.summary ? { summary: message.summary } : {}),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  }
}

export function toPublicStudioSceneSnapshot(snapshot: StudioSceneSnapshot): PublicStudioSceneSnapshot {
  return {
    scene: toPublicStudioScene(snapshot.scene),
    messages: snapshot.messages.map(toPublicStudioSceneMessage),
    runs: snapshot.runs.map(toPublicStudioSceneRun),
    renders: snapshot.renders.map(toPublicStudioSceneRender),
  }
}

/**
 * Public transport sanitizer. The SSE path publishes internal Run objects, so `run.updated`
 * must be re-derived through `toPublicStudioRun`; `ownerId` never leaves the server.
 */
export function toPublicStudioEvent(event: StudioExternalEvent): StudioExternalEvent {
  if (event.type === 'run.updated') {
    return {
      ...event,
      properties: {
        ...event.properties,
        run: toPublicStudioRun(event.properties.run as StudioRun),
      },
    }
  }

  if (event.type !== 'render.updated') {
    return event
  }

  return {
    ...event,
    properties: {
      ...event.properties,
      render: toPublicStudioRender(event.properties.render as StudioRender),
    },
  }
}

/**
 * Scene-stream sanitizer. Same redaction as the Session stream plus the Scene whitelist: Run and
 * Render are re-derived, a `tool.result` keeps its status, title, public media and a public Tool
 * presentation (a completed static check becomes a count summary; a failed Tool keeps no result
 * text) while its Scene scope stays. Streaming text and the model's own Tool argument echo pass
 * through unchanged.
 */
export function toPublicStudioSceneEvent(event: StudioExternalEvent): StudioExternalEvent {
  if (event.type === 'run.updated') {
    return {
      ...event,
      properties: {
        ...event.properties,
        run: toPublicStudioSceneRun(event.properties.run as StudioRun),
      },
    }
  }

  if (event.type === 'render.updated') {
    return {
      ...event,
      properties: {
        ...event.properties,
        render: toPublicStudioSceneRender(event.properties.render as StudioRender),
      },
    }
  }

  if (event.type !== 'tool.result') {
    return event
  }

  const properties = event.properties as {
    sessionId?: unknown
    sceneId?: unknown
    runId?: unknown
    messageId?: unknown
    toolName?: unknown
    callId?: unknown
    status?: unknown
    title?: unknown
    output?: unknown
    metadata?: Record<string, unknown>
    attachments?: StudioFileAttachment[]
  }
  const metadata = toPublicStudioSceneMetadata(properties.metadata)
  const attachments = toPublicStudioSceneAttachments(properties.attachments)
  const presentation = projectStudioSceneToolPresentation({
    tool: typeof properties.toolName === 'string' ? properties.toolName : '',
    status: readStudioSceneToolPresentationStatus(properties.status),
    title: properties.title,
    output: properties.output,
    metadata: properties.metadata
  })

  return {
    ...event,
    properties: {
      sessionId: properties.sessionId,
      ...(typeof properties.sceneId === 'string' ? { sceneId: properties.sceneId } : {}),
      runId: properties.runId,
      messageId: properties.messageId,
      toolName: properties.toolName,
      callId: properties.callId,
      status: properties.status,
      ...(typeof presentation.title === 'string' ? { title: presentation.title } : {}),
      ...(typeof presentation.output === 'string' ? { output: presentation.output } : {}),
      ...(metadata ? { metadata } : {}),
      ...(attachments ? { attachments } : {}),
    },
  }
}
