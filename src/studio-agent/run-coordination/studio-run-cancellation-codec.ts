import { randomUUID } from 'node:crypto'
import {
  STUDIO_RUN_CANCELLED_BY_USER_REASON,
  STUDIO_RUN_MAX_NAME_LENGTH,
  type StudioRunCancellationCommand
} from './studio-run-coordinator'

export const STUDIO_RUN_CANCELLATION_VERSION = 1
export const STUDIO_RUN_CANCELLATION_REASON_MAX_LENGTH = 200
/** An ISO-8601 instant with an offset is well below this; anything longer is not a timestamp. */
export const STUDIO_RUN_CANCELLATION_TIMESTAMP_MAX_LENGTH = 40
/**
 * Conservative ceiling for one raw cancellation envelope. The four fields are all small
 * (a UUID, a bounded Run id, a reason bounded to 200 and an ISO instant), so a legitimate command
 * stays around 0.5 KB. A hostile publisher must not be able to force an unbounded allocation, and
 * rejection must not require parsing.
 */
export const STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH = 2_048

export type StudioRunCancellationDecodeResult =
  | { ok: true; command: StudioRunCancellationCommand }
  | { ok: false; reason: string }

/** One pipelined command reply: `[error, result]`, or `undefined` when the pipeline failed. */
export type StudioRunCancellationCommandReply = readonly [unknown, unknown] | undefined

/**
 * Normalizes a caller-supplied reason before it reaches Redis, persistence or logs: trimmed,
 * whitespace-collapsed, bounded, and never empty (an empty reason would make a cancelled Run
 * indistinguishable from an unexplained one).
 */
export function normalizeStudioRunCancellationReason(
  reason?: string,
  fallback: string = STUDIO_RUN_CANCELLED_BY_USER_REASON
): string {
  const collapsed = (reason ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) {
    return fallback
  }
  return collapsed.slice(0, STUDIO_RUN_CANCELLATION_REASON_MAX_LENGTH)
}

/**
 * Validates the acknowledgement of the pipelined durable marker write. A missing reply, a
 * command error, or anything other than `OK` means the marker was not durably recorded, so the
 * caller must report coordination as unavailable instead of claiming a cancellation.
 *
 * The thrown message never contains the command payload or raw transport details; the
 * underlying error travels as `cause` for operators.
 */
export function assertStudioRunCancellationMarkerWritten(
  reply: StudioRunCancellationCommandReply
): void {
  if (!reply) {
    throw new Error('Studio Run cancellation marker write returned no reply')
  }
  const [error, result] = reply
  if (error) {
    throw new Error('Studio Run cancellation marker write failed', { cause: error })
  }
  if (result !== 'OK') {
    throw new Error('Studio Run cancellation marker write did not acknowledge OK')
  }
}

export function createStudioRunCancellationCommand(input: {
  runId: string
  reason?: string
  commandId?: string
  requestedAt?: string
}): StudioRunCancellationCommand {
  return {
    version: STUDIO_RUN_CANCELLATION_VERSION,
    commandId: input.commandId ?? randomUUID(),
    runId: input.runId,
    reason: normalizeStudioRunCancellationReason(input.reason),
    requestedAt: input.requestedAt ?? new Date().toISOString()
  }
}

export function encodeStudioRunCancellationCommand(command: StudioRunCancellationCommand): string {
  return JSON.stringify(command)
}

/**
 * Never throws: a malformed or oversized command is rejected with a short reason instead of
 * crashing a listener. Every field is bounded, so a hostile publisher cannot make a replica
 * allocate or store unbounded values.
 */
export function decodeStudioRunCancellationCommand(raw: unknown): StudioRunCancellationDecodeResult {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'cancellation command is not a string' }
  }

  // Bounded before `trim()` and before `JSON.parse()`: an oversized envelope is rejected by length
  // alone, so it can never force an unbounded allocation or an unbounded parse.
  if (raw.length > STUDIO_RUN_CANCELLATION_MAX_PAYLOAD_LENGTH) {
    return { ok: false, reason: 'cancellation command exceeds the payload length limit' }
  }

  if (!raw.trim()) {
    return { ok: false, reason: 'cancellation command is empty' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'cancellation command is not valid JSON' }
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: 'cancellation command is not an object' }
  }
  if (parsed.version !== STUDIO_RUN_CANCELLATION_VERSION) {
    return { ok: false, reason: 'cancellation command version is not supported' }
  }

  const commandId = readBoundedString(parsed.commandId, STUDIO_RUN_MAX_NAME_LENGTH)
  const runId = readBoundedString(parsed.runId, STUDIO_RUN_MAX_NAME_LENGTH)
  const requestedAt = readBoundedString(parsed.requestedAt, STUDIO_RUN_CANCELLATION_TIMESTAMP_MAX_LENGTH)
  if (!commandId || !runId || !requestedAt) {
    return { ok: false, reason: 'cancellation command is missing a required field or exceeds the field length limit' }
  }

  // A transported reason is normalized exactly like a local one, then required to survive
  // normalization: an empty reason cannot describe a cancellation.
  const reason = typeof parsed.reason === 'string' ? normalizeStudioRunCancellationReason(parsed.reason, '') : ''
  if (!reason) {
    return { ok: false, reason: 'cancellation command reason is empty after normalization' }
  }

  if (!Number.isFinite(Date.parse(requestedAt))) {
    return { ok: false, reason: 'cancellation command has an unparseable timestamp' }
  }

  return {
    ok: true,
    command: {
      version: STUDIO_RUN_CANCELLATION_VERSION,
      commandId,
      runId,
      reason,
      requestedAt
    }
  }
}

/**
 * Encodes a session or Run id for use inside a Redis key. Identifiers are not trusted to be
 * key-safe (a crafted id must not be able to address `lease:` vs `cancel:` namespaces), so
 * everything outside an explicit allow-list is percent-encoded.
 */
export function encodeStudioRunKeySegment(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > STUDIO_RUN_MAX_NAME_LENGTH) {
    throw new Error(`Studio Run coordination identifiers must be 1-${STUDIO_RUN_MAX_NAME_LENGTH} characters`)
  }
  return trimmed.replace(/[^A-Za-z0-9_-]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

function readBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maxLength) {
    return null
  }
  return trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
