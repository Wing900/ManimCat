import type { StudioAgentEvent } from './event-types'

/**
 * Canonical Scene scope of a Studio event.
 *
 * Pure domain logic: no Express, no Redis, no Event Bus, no frontend. Both the SSE delivery
 * boundary and the transport envelope use these helpers, so the routing rule exists exactly once.
 *
 * Authority per event kind:
 * - `run_updated`   → `event.run.sceneId`
 * - `render_updated`→ `event.render.sceneId`
 * - streaming/tool  → `event.sceneId`, stamped at the single dispatch boundary from the owning
 *                     Run's scope (never from model Tool input or client metadata)
 */

/** Bounded identifier rule shared with the transport envelope. */
export const STUDIO_EVENT_SCOPE_ID_MAX_LENGTH = 128

export interface StudioEventScope {
  sessionId: string
  sceneId: string
}

/**
 * True for a non-empty, whitespace-free, bounded identifier. Anything else (empty, padded,
 * control characters, over-long) is treated as malformed scope and fails closed.
 */
export function isStudioEventScopeIdentifier(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > STUDIO_EVENT_SCOPE_ID_MAX_LENGTH) {
    return false
  }
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f\s]/.test(value)
}

/**
 * Scene id an event belongs to, or `undefined` when the event carries no trustworthy Scene scope
 * (which includes every Legacy event). Malformed values are treated as absent, never thrown.
 */
export function readStudioEventSceneId(event: StudioAgentEvent): string | undefined {
  if (event.type === 'run_updated') {
    return readSceneIdOf(event.run)
  }
  if (event.type === 'render_updated') {
    return readSceneIdOf(event.render)
  }
  return readSceneIdOf(event)
}

/**
 * Exact Scene matching for one authenticated stream: the Session must match and the Scene must be
 * the selected Scene. Missing, empty, malformed and mismatched scopes all return `false`, so a
 * sibling Scene or a Legacy event can never leak into a Scene stream.
 */
export function matchesStudioEventScope(event: StudioAgentEvent, scope: StudioEventScope): boolean {
  if (!isStudioEventScopeIdentifier(scope.sessionId) || !isStudioEventScopeIdentifier(scope.sceneId)) {
    return false
  }
  if (event.sessionId !== scope.sessionId) {
    return false
  }

  const sceneId = readStudioEventSceneId(event)
  return sceneId !== undefined && sceneId === scope.sceneId
}

function readSceneIdOf(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') {
    return undefined
  }
  const sceneId = (record as { sceneId?: unknown }).sceneId
  return isStudioEventScopeIdentifier(sceneId) ? sceneId : undefined
}
