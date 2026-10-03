import { isStudioEventScopeIdentifier } from '../protocol/studio-agent-events'
import type {
  StudioAgentType,
  StudioKind,
  StudioRenderStatus,
  StudioRunStatus,
  StudioSceneAttachment,
  StudioSceneRender,
  StudioSceneRun,
  StudioTokenUsage,
} from '../protocol/studio-agent-types'
import type {
  StudioCinemaSceneIdentity,
  StudioCinemaScopedSceneEvent,
} from './types'

/**
 * Scene event decoder.
 *
 * The input is the raw `JSON.parse` result of one SSE frame, so no shape is guaranteed. Every field
 * the Scene store keeps is verified and copied here, and a frame that is malformed, carries an
 * unknown type, or carries no verifiable Scene scope decodes to `null`. There is deliberately no
 * cast from the wider Legacy event types into the Scene records: a Legacy Session frame (no
 * `sceneId`) can never become a Scene event, and the model's Tool `raw`/`input`, the internal
 * `error` text and the private `sourcePath` are never copied into a Scene record.
 */
export function decodeStudioCinemaSceneEvent(event: unknown): StudioCinemaScopedSceneEvent | null {
  if (!isRecord(event)) {
    return null
  }

  const type = event.type
  const properties = event.properties
  if (typeof type !== 'string' || !isRecord(properties)) {
    return null
  }

  if (type === 'studio.connected' || type === 'studio.heartbeat') {
    // Connection frames carry no Scene scope: they update connection state, never a Scene record.
    return {
      identity: null,
      event: {
        kind: 'connection',
        state: type === 'studio.connected' ? 'connected' : 'heartbeat',
        timestamp: readFiniteNumber(properties.timestamp) ?? 0,
      },
    }
  }

  const sessionId = readIdentifier(properties.sessionId)
  if (!sessionId) {
    return null
  }

  if (type === 'run.updated') {
    const run = decodeSceneRun(properties.run)
    const identity = run ? readScopedIdentity(sessionId, run.sceneId) : null
    return identity && run ? { identity, event: { kind: 'run-updated', run } } : null
  }

  if (type === 'render.updated') {
    const render = decodeSceneRender(properties.render)
    const identity = render ? readScopedIdentity(sessionId, render.sceneId) : null
    return identity && render ? { identity, event: { kind: 'render-updated', render } } : null
  }

  const identity = readScopedIdentity(sessionId, properties.sceneId)
  if (!identity) {
    return null
  }

  const runId = readIdentifier(properties.runId)
  const messageId = readIdentifier(properties.messageId)
  if (!runId || !messageId) {
    return null
  }

  if (type === 'assistant.text') {
    if (typeof properties.text !== 'string') {
      return null
    }
    return { identity, event: { kind: 'assistant-text', runId, messageId, text: properties.text } }
  }

  const toolName = readIdentifier(properties.toolName)
  const callId = readIdentifier(properties.callId)
  if (!toolName || !callId) {
    return null
  }

  if (type === 'tool.input-start') {
    // The model's own argument echo stays out of the Scene store by construction.
    return { identity, event: { kind: 'tool-input-start', runId, messageId, toolName, callId } }
  }

  if (type === 'tool.call') {
    return { identity, event: { kind: 'tool-call', runId, messageId, toolName, callId } }
  }

  if (type === 'tool.result') {
    const status = properties.status
    if (status !== 'completed' && status !== 'failed') {
      return null
    }
    const title = readOptionalString(properties.title)
    const output = readOptionalString(properties.output)
    const metadata = isRecord(properties.metadata) ? { ...properties.metadata } : undefined
    const attachments = decodeSceneAttachments(properties.attachments)
    return {
      identity,
      event: {
        kind: 'tool-result',
        runId,
        messageId,
        toolName,
        callId,
        status,
        ...(title === undefined ? {} : { title }),
        ...(output === undefined ? {} : { output }),
        ...(metadata === undefined ? {} : { metadata }),
        ...(attachments === undefined ? {} : { attachments }),
      },
    }
  }

  return null
}

/** Identity that carries a concrete Scene id; a frame without one never scopes to a Scene. */
function readScopedIdentity(sessionId: string, sceneId: unknown): StudioCinemaSceneIdentity | null {
  const scene = readIdentifier(sceneId)
  return scene ? { sessionId, sceneId: scene } : null
}

/**
 * One Scene Run narrowed out of any response body. Exported because the cancel response carries the
 * same record: the Scene store must never hold the wider Legacy Run (with `error`/`metadata`).
 */
export function readStudioCinemaSceneRun(value: unknown): StudioSceneRun | null {
  return decodeSceneRun(value)
}

function decodeSceneRun(value: unknown): StudioSceneRun | null {
  if (!isRecord(value)) {
    return null
  }
  const id = readIdentifier(value.id)
  const sessionId = readIdentifier(value.sessionId)
  const sceneId = readIdentifier(value.sceneId)
  const status = readRunStatus(value.status)
  const activeAgent = readAgentType(value.activeAgent)
  const createdAt = readOptionalString(value.createdAt)
  if (!id || !sessionId || !sceneId || !status || !activeAgent || createdAt === undefined || typeof value.inputText !== 'string') {
    return null
  }

  const completedAt = readOptionalString(value.completedAt)
  const tokenUsage = decodeTokenUsage(value.tokenUsage)
  return {
    id,
    sessionId,
    sceneId,
    status,
    inputText: value.inputText,
    activeAgent,
    createdAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
  }
}

function decodeSceneRender(value: unknown): StudioSceneRender | null {
  if (!isRecord(value)) {
    return null
  }
  const id = readIdentifier(value.id)
  const sessionId = readIdentifier(value.sessionId)
  const kind = readStudioKind(value.kind)
  const status = readRenderStatus(value.status)
  const outputMode = value.outputMode === 'video' || value.outputMode === 'image' ? value.outputMode : null
  const createdAt = readOptionalString(value.createdAt)
  const updatedAt = readOptionalString(value.updatedAt)
  if (
    !id ||
    !sessionId ||
    !kind ||
    !status ||
    !outputMode ||
    createdAt === undefined ||
    updatedAt === undefined ||
    typeof value.title !== 'string' ||
    typeof value.concept !== 'string'
  ) {
    return null
  }

  const sceneId = readIdentifier(value.sceneId)
  const runId = readIdentifier(value.runId)
  const quality = value.quality === 'low' || value.quality === 'medium' || value.quality === 'high' ? value.quality : undefined
  const jobId = readOptionalString(value.jobId)
  const metadata = isRecord(value.metadata) ? { ...value.metadata } : undefined
  const attachments = decodeSceneAttachments(value.attachments)
  return {
    id,
    sessionId,
    ...(sceneId === undefined ? {} : { sceneId }),
    ...(runId === undefined ? {} : { runId }),
    kind,
    title: value.title,
    status,
    concept: value.concept,
    outputMode,
    ...(quality === undefined ? {} : { quality }),
    ...(jobId === undefined ? {} : { jobId }),
    ...(attachments === undefined ? {} : { attachments }),
    ...(metadata === undefined ? {} : { metadata }),
    createdAt,
    updatedAt,
  }
}

/**
 * Public attachments only: one `file` entry with a public locator string. Everything else in the
 * array is dropped instead of being copied, because the Scene store must not hold a value it did
 * not verify.
 */
export function decodeSceneAttachments(value: unknown): StudioSceneAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const attachments: StudioSceneAttachment[] = []
  for (const item of value) {
    if (!isRecord(item) || item.kind !== 'file') {
      continue
    }
    const path = readOptionalString(item.path)
    if (path === undefined || path === '') {
      continue
    }
    const name = readOptionalString(item.name)
    const mimeType = readOptionalString(item.mimeType)
    attachments.push({
      kind: 'file',
      path,
      ...(name === undefined ? {} : { name }),
      ...(mimeType === undefined ? {} : { mimeType }),
    })
  }

  return attachments.length ? attachments : undefined
}

function decodeTokenUsage(value: unknown): StudioTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const promptTokens = readFiniteNumber(value.promptTokens)
  const completionTokens = readFiniteNumber(value.completionTokens)
  const totalTokens = readFiniteNumber(value.totalTokens)
  const measuredCalls = readFiniteNumber(value.measuredCalls)
  const unmeasuredCalls = readFiniteNumber(value.unmeasuredCalls)
  if (
    promptTokens === undefined ||
    completionTokens === undefined ||
    totalTokens === undefined ||
    measuredCalls === undefined ||
    unmeasuredCalls === undefined
  ) {
    return undefined
  }
  return { promptTokens, completionTokens, totalTokens, measuredCalls, unmeasuredCalls }
}

const STUDIO_RUN_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
])

const STUDIO_RENDER_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
])

function readRunStatus(value: unknown): StudioRunStatus | undefined {
  return typeof value === 'string' && STUDIO_RUN_STATUSES.has(value) ? (value as StudioRunStatus) : undefined
}

function readRenderStatus(value: unknown): StudioRenderStatus | undefined {
  return typeof value === 'string' && STUDIO_RENDER_STATUSES.has(value)
    ? (value as StudioRenderStatus)
    : undefined
}

function readStudioKind(value: unknown): StudioKind | undefined {
  return value === 'manim' || value === 'plot' ? value : undefined
}

function readAgentType(value: unknown): StudioAgentType | undefined {
  return value === 'builder' ? value : undefined
}

function readIdentifier(value: unknown): string | undefined {
  return isStudioEventScopeIdentifier(value) ? value : undefined
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
