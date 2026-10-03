import type {
  StudioCreateSceneRunResponse,
  StudioSceneMessage,
  StudioScenePart,
  StudioSceneRender,
  StudioSceneRun,
  StudioSceneSnapshot,
} from '../protocol/studio-agent-types'
import { readStudioCinemaSceneRun } from './scene-events'
import type { StudioCinemaSceneIdentity } from './types'

/**
 * Task 11C7-A: the one pure rule that proves a response payload belongs to the Scene an action
 * names. A legal action identity only selects the map entry; it says nothing about the payload, so
 * every write path asks this module first. No React, no network, no store dependency.
 *
 * Field rules, taken from the public types:
 * - a Scene names its own `id` and `sessionId`;
 * - a Run/Render carries `sessionId` and (in a Scene projection) `sceneId`, so a record without
 *   `sceneId` is a Legacy record and never belongs to a Scene;
 * - a message carries `sessionId` and an optional `sceneId` (the public projection omits it when the
 *   stored message has none), and each part carries `sessionId` plus the `messageId` it belongs to.
 */

/** One record is scoped to the identity when both fields name it. A missing `sceneId` is Legacy. */
export function isStudioCinemaScopedRecordForIdentity(
  identity: StudioCinemaSceneIdentity,
  record: { sessionId?: string; sceneId?: string },
): boolean {
  return record.sessionId === identity.sessionId && record.sceneId === identity.sceneId
}

export function isStudioCinemaSceneRunForIdentity(
  identity: StudioCinemaSceneIdentity,
  run: StudioSceneRun,
): boolean {
  return isStudioCinemaScopedRecordForIdentity(identity, run)
}

export function isStudioCinemaSceneRenderForIdentity(
  identity: StudioCinemaSceneIdentity,
  render: StudioSceneRender,
): boolean {
  return isStudioCinemaScopedRecordForIdentity(identity, render)
}

function isStudioCinemaPartForMessage(
  identity: StudioCinemaSceneIdentity,
  messageId: string,
  part: StudioScenePart,
): boolean {
  if (part.sessionId !== identity.sessionId) {
    return false
  }
  return part.messageId === messageId
}

export function isStudioCinemaSceneMessageForIdentity(
  identity: StudioCinemaSceneIdentity,
  message: StudioSceneMessage,
): boolean {
  if (message.sessionId !== identity.sessionId) {
    return false
  }
  if (message.sceneId !== undefined && message.sceneId !== identity.sceneId) {
    return false
  }
  if (message.role !== 'assistant') {
    return true
  }
  return message.parts.every((part) => isStudioCinemaPartForMessage(identity, message.id, part))
}

/** The whole snapshot is proven, or it is refused as a unit: never merge a few rows and call it authoritative. */
export function isStudioCinemaSceneSnapshotForIdentity(
  identity: StudioCinemaSceneIdentity,
  snapshot: StudioSceneSnapshot,
): boolean {
  if (snapshot.scene.id !== identity.sceneId || snapshot.scene.sessionId !== identity.sessionId) {
    return false
  }
  if (!snapshot.messages.every((message) => isStudioCinemaSceneMessageForIdentity(identity, message))) {
    return false
  }
  if (!snapshot.runs.every((run) => isStudioCinemaSceneRunForIdentity(identity, run))) {
    return false
  }
  return snapshot.renders.every((render) => isStudioCinemaSceneRenderForIdentity(identity, render))
}

/** The accepted Run of a submit is validated on its own, not only through the snapshot's `runs`. */
export function isStudioCinemaAcceptedRunResponseForIdentity(
  identity: StudioCinemaSceneIdentity,
  response: StudioCreateSceneRunResponse,
): boolean {
  return (
    isStudioCinemaSceneSnapshotForIdentity(identity, response) &&
    isStudioCinemaSceneRunForIdentity(identity, response.run)
  )
}

/** The official Run status set; an unsupported value is refused instead of being cast through. */
const STUDIO_CINEMA_RUN_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
])

export function isStudioCinemaRunStatus(value: unknown): boolean {
  return typeof value === 'string' && STUDIO_CINEMA_RUN_STATUSES.has(value)
}

/**
 * The cancel response is a three-way decision, so `null` never has to mean compatibility, rejection
 * and absence at once:
 * - `status-only`: the official shape where the `run` property is **absent** (legacy compatibility);
 * - `run`: the property is present, decodes as a complete public Run, and matches the requested
 *   `runId` plus the Scene identity;
 * - `rejected`: the property is present but malformed (including an explicit `null`), belongs to
 *   another Run/Scene/Session, or the top-level status is outside the official set. Present but
 *   malformed is never treated as absent.
 */
export type StudioCinemaCancelRunVerdict =
  | { kind: 'status-only' }
  | { kind: 'run'; run: StudioSceneRun }
  | { kind: 'rejected'; reason: 'malformed-run' | 'unsupported-status' | 'target-mismatch' }

export function readStudioCinemaCancelRunVerdict(
  identity: StudioCinemaSceneIdentity,
  runId: string,
  payload: { status?: unknown; run?: unknown },
): StudioCinemaCancelRunVerdict {
  if (!isStudioCinemaRunStatus(payload.status)) {
    return { kind: 'rejected', reason: 'unsupported-status' }
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'run')) {
    return { kind: 'status-only' }
  }
  const decoded = readStudioCinemaSceneRun(payload.run)
  if (!decoded) {
    return { kind: 'rejected', reason: 'malformed-run' }
  }
  if (decoded.id !== runId || !isStudioCinemaSceneRunForIdentity(identity, decoded)) {
    return { kind: 'rejected', reason: 'target-mismatch' }
  }
  return { kind: 'run', run: decoded }
}
