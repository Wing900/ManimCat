import type {
  StudioFileAttachment,
  StudioRun,
  StudioRender,
} from './studio-agent-types'

export interface StudioRunUpdatedExternalEvent {
  type: 'run.updated'
  properties: {
    sessionId: string
    run: StudioRun
  }
}

export interface StudioRenderUpdatedExternalEvent {
  type: 'render.updated'
  properties: {
    sessionId: string
    runId?: string
    render: StudioRender
  }
}

export interface StudioAssistantTextExternalEvent {
  type: 'assistant.text'
  properties: {
    sessionId: string
    /** Scene scope of the owning Run; absent on a Legacy Session stream event. */
    sceneId?: string
    runId: string
    messageId: string
    text: string
  }
}

export interface StudioToolInputStartExternalEvent {
  type: 'tool.input-start'
  properties: {
    sessionId: string
    sceneId?: string
    runId: string
    messageId: string
    toolName: string
    callId: string
    raw: string
  }
}

export interface StudioToolCallExternalEvent {
  type: 'tool.call'
  properties: {
    sessionId: string
    sceneId?: string
    runId: string
    messageId: string
    toolName: string
    callId: string
    input: Record<string, unknown>
  }
}

export interface StudioToolResultExternalEvent {
  type: 'tool.result'
  properties: {
    sessionId: string
    sceneId?: string
    runId: string
    messageId: string
    toolName: string
    callId: string
    status: 'completed' | 'failed'
    title?: string
    output?: string
    metadata?: Record<string, unknown>
    attachments?: StudioFileAttachment[]
    error?: string
  }
}

export interface StudioConnectedExternalEvent {
  type: 'studio.connected'
  properties: {
    timestamp: number
  }
}

export interface StudioHeartbeatExternalEvent {
  type: 'studio.heartbeat'
  properties: {
    timestamp: number
  }
}

export type StudioExternalEvent =
  | StudioRunUpdatedExternalEvent
  | StudioRenderUpdatedExternalEvent
  | StudioAssistantTextExternalEvent
  | StudioToolInputStartExternalEvent
  | StudioToolCallExternalEvent
  | StudioToolResultExternalEvent
  | StudioConnectedExternalEvent
  | StudioHeartbeatExternalEvent

/** Selected Scene scope of a stream, as accepted by the backend SSE routes. */
export interface StudioEventScope {
  sessionId: string
  sceneId: string
}

/** Wire bound mirrored from the backend scope rule; keeps a malformed id from ever matching. */
const STUDIO_EVENT_SCOPE_ID_MAX_LENGTH = 128

/** Event types that may carry a Scene scope; every other type answers `undefined`. */
const STUDIO_SCENE_SCOPED_EXTERNAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'run.updated',
  'render.updated',
  'assistant.text',
  'tool.input-start',
  'tool.call',
  'tool.result',
])

/**
 * Scene scope of one external event, or `undefined` when the event carries none.
 *
 * The parameter is `unknown` on purpose: the value comes from `JSON.parse`, so no shape is
 * guaranteed. Every level is verified (non-array object, known `type`, object `properties`, object
 * nested `run`/`render`) and a malformed value answers `undefined` instead of throwing, so a broken
 * frame can never attach itself to a Scene. The UI must never infer Scene identity from message
 * text, and a missing, empty, over-long, padded or control-character identifier counts as absent.
 */
export function readStudioExternalEventSceneId(event: unknown): string | undefined {
  if (!isStudioRecord(event)) {
    return undefined
  }

  const type = event.type
  if (typeof type !== 'string' || !STUDIO_SCENE_SCOPED_EXTERNAL_EVENT_TYPES.has(type)) {
    return undefined
  }

  const properties = event.properties
  if (!isStudioRecord(properties)) {
    return undefined
  }

  if (type === 'run.updated') {
    return isStudioRecord(properties.run) ? readSceneIdentifier(properties.run.sceneId) : undefined
  }
  if (type === 'render.updated') {
    return isStudioRecord(properties.render) ? readSceneIdentifier(properties.render.sceneId) : undefined
  }
  return readSceneIdentifier(properties.sceneId)
}

function isStudioRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * True for a wire identifier: a non-empty string within the shared length bound that carries no
 * whitespace and no control character. One rule for every identifier the Scene client reads
 * (Session, Scene, Run, Message, Tool call), so no field can accept a looser value than another.
 */
export function isStudioEventScopeIdentifier(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > STUDIO_EVENT_SCOPE_ID_MAX_LENGTH) {
    return false
  }
  return !/[\u0000-\u001f\u007f\s]/.test(value)
}

function readSceneIdentifier(value: unknown): string | undefined {
  return isStudioEventScopeIdentifier(value) ? value : undefined
}

