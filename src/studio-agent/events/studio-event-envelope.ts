import { randomUUID } from 'node:crypto'
import type {
  StudioAgentEvent,
  StudioFileAttachment,
  StudioRun,
  StudioRender,
  StudioToolResultEvent
} from '../domain/types'

/**
 * Versioned transport envelope for Studio events.
 *
 * The codec is independent from ioredis and from the domain bus: it turns a domain event
 * into a JSON string and back. Encoding may throw (callers catch); decoding never throws
 * and never trusts parsed JSON — every required field is validated and each event is
 * rebuilt from validated values instead of being cast blindly.
 */

export const STUDIO_EVENT_ENVELOPE_VERSION = 1

export interface StudioEventEnvelopeV1 {
  version: 1
  eventId: string
  originId: string
  publishedAt: string
  sessionId: string
  event: StudioAgentEvent
}

export type StudioEventEnvelopeDecodeResult =
  | { ok: true; envelope: StudioEventEnvelopeV1 }
  | { ok: false; reason: string }

/** Stable per-process identifier used to drop own-origin echoes. */
export function createStudioEventOriginId(): string {
  return `${process.pid}-${randomUUID()}`
}

/** Fresh envelope identity. */
export function createStudioEventId(): string {
  return randomUUID()
}

/**
 * Builds an envelope for a local event. Throws only on programmer error (missing origin or
 * event identity, or an event without a session id); the distributed bus catches it and
 * records a serialization failure instead of breaking the synchronous publish path.
 */
export function createStudioEventEnvelope(input: {
  event: StudioAgentEvent
  originId: string
  eventId?: string
  publishedAt?: string
}): StudioEventEnvelopeV1 {
  const sessionId = readStudioEventSessionId(input.event)
  if (typeof input.originId !== 'string' || input.originId.trim() === '') {
    throw new Error('Studio event envelope requires a non-empty originId')
  }
  if (sessionId === '') {
    throw new Error('Studio event envelope requires an event session id')
  }

  return {
    version: STUDIO_EVENT_ENVELOPE_VERSION,
    eventId: input.eventId ?? createStudioEventId(),
    originId: input.originId,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    sessionId,
    event: input.event
  }
}

export function encodeStudioEventEnvelope(envelope: StudioEventEnvelopeV1): string {
  return JSON.stringify(envelope)
}

export function decodeStudioEventEnvelope(serialized: string): StudioEventEnvelopeDecodeResult {
  if (typeof serialized !== 'string' || serialized.trim() === '') {
    return reject('envelope is not a non-empty string')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return reject('envelope is not valid JSON')
  }

  if (!isRecord(parsed)) {
    return reject('envelope is not an object')
  }
  if (parsed.version !== STUDIO_EVENT_ENVELOPE_VERSION) {
    return reject('unsupported envelope version')
  }

  const eventId = readIdentifier(parsed.eventId)
  const originId = readIdentifier(parsed.originId)
  const sessionId = readIdentifier(parsed.sessionId)
  if (!eventId || !originId || !sessionId) {
    return reject('envelope identifiers are missing or empty')
  }

  const publishedAt = parsed.publishedAt
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) {
    return reject('envelope timestamp is missing or invalid')
  }

  const event = readStudioAgentEvent(parsed.event, sessionId)
  if (!event) {
    return reject('envelope event is invalid or does not match the envelope session')
  }

  return {
    ok: true,
    envelope: { version: STUDIO_EVENT_ENVELOPE_VERSION, eventId, originId, publishedAt, sessionId, event }
  }
}

/** Session a domain event belongs to; the single routing key of the local bus. */
export function readStudioEventSessionId(event: StudioAgentEvent): string {
  const sessionId = (event as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' ? sessionId : ''
}

function reject(reason: string): StudioEventEnvelopeDecodeResult {
  return { ok: false, reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  return value.trim() === '' ? undefined : value.trim()
}

/**
 * Validates the minimum fields a `StudioAgentEvent` discriminant requires and returns a
 * rebuilt event, so no parsed JSON reaches listeners through a blind cast. Unknown
 * discriminants and malformed fields are rejected.
 */
function readStudioAgentEvent(value: unknown, envelopeSessionId: string): StudioAgentEvent | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const sessionId = readIdentifier(value.sessionId)
  if (!sessionId || sessionId !== envelopeSessionId) {
    return undefined
  }

  switch (value.type) {
    case 'assistant_text': {
      const runId = readIdentifier(value.runId)
      const messageId = readIdentifier(value.messageId)
      if (!runId || !messageId || typeof value.text !== 'string') {
        return undefined
      }
      return { type: 'assistant_text', sessionId, runId, messageId, text: value.text }
    }

    case 'tool_input_start': {
      const runId = readIdentifier(value.runId)
      const messageId = readIdentifier(value.messageId)
      const toolName = readIdentifier(value.toolName)
      const callId = readIdentifier(value.callId)
      if (!runId || !messageId || !toolName || !callId) {
        return undefined
      }
      if (value.raw !== undefined && typeof value.raw !== 'string') {
        return undefined
      }
      return {
        type: 'tool_input_start',
        sessionId,
        runId,
        messageId,
        toolName,
        callId,
        ...(typeof value.raw === 'string' ? { raw: value.raw } : {})
      }
    }

    case 'tool_call': {
      const runId = readIdentifier(value.runId)
      const messageId = readIdentifier(value.messageId)
      const toolName = readIdentifier(value.toolName)
      const callId = readIdentifier(value.callId)
      if (!runId || !messageId || !toolName || !callId) {
        return undefined
      }
      // `input` is required by the domain type, so an absent key is malformed (fail closed).
      if (!Object.prototype.hasOwnProperty.call(value, 'input')) {
        return undefined
      }
      return { type: 'tool_call', sessionId, runId, messageId, toolName, callId, input: value.input }
    }

    case 'tool_result': {
      const runId = readIdentifier(value.runId)
      const messageId = readIdentifier(value.messageId)
      const toolName = readIdentifier(value.toolName)
      const callId = readIdentifier(value.callId)
      const status = value.status
      if (!runId || !messageId || !toolName || !callId) {
        return undefined
      }
      if (status !== 'completed' && status !== 'failed') {
        return undefined
      }

      const event: StudioToolResultEvent = { type: 'tool_result', sessionId, runId, messageId, toolName, callId, status }
      const title = value.title
      const output = value.output
      const error = value.error
      const metadata = value.metadata
      const attachments = value.attachments
      if (title !== undefined) {
        if (typeof title !== 'string') return undefined
        event.title = title
      }
      if (output !== undefined) {
        if (typeof output !== 'string') return undefined
        event.output = output
      }
      if (error !== undefined) {
        if (typeof error !== 'string') return undefined
        event.error = error
      }
      if (metadata !== undefined) {
        if (!isRecord(metadata)) return undefined
        event.metadata = metadata
      }
      if (attachments !== undefined) {
        if (!Array.isArray(attachments)) return undefined
        event.attachments = attachments as StudioFileAttachment[]
      }
      return event
    }

    case 'run_updated': {
      const run = readSessionScopedRecord(value.run, sessionId)
      if (!run) {
        return undefined
      }
      // Shape beyond id/sessionId is validated where it is consumed (public DTO sanitizer).
      return { type: 'run_updated', sessionId, run: run as unknown as StudioRun }
    }

    case 'render_updated': {
      const render = readSessionScopedRecord(value.render, sessionId)
      if (!render) {
        return undefined
      }
      if (value.runId !== undefined && typeof value.runId !== 'string') {
        return undefined
      }
      return {
        type: 'render_updated',
        sessionId,
        render: render as unknown as StudioRender,
        ...(typeof value.runId === 'string' ? { runId: value.runId } : {})
      }
    }

    default:
      return undefined
  }
}

/** Nested payloads (`run` / `render`) must be records owned by the envelope session. */
function readSessionScopedRecord(value: unknown, sessionId: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (!readIdentifier(value.id)) {
    return undefined
  }
  return readIdentifier(value.sessionId) === sessionId ? value : undefined
}
