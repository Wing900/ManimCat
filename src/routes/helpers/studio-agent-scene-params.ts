import { isStudioEventScopeIdentifier } from '../../studio-agent/domain/event-scope'

/**
 * Path parameters of a Scene-scoped endpoint.
 *
 * The URL owns Session and Scene identity, so both segments are validated as identifiers before any
 * store lookup, before any authorization decision and before any SSE header: the rule is the same
 * bounded Domain identifier rule the event scope uses (non-empty, at most 128 characters, no
 * whitespace and no control character). A malformed segment is a request-shape error (400); a
 * well-formed but unreachable identity is the non-enumerating 404 decided later.
 */
export interface StudioScenePathParams {
  sessionId: string
  sceneId: string
}

export function parseStudioScenePathParams(
  params: { sessionId?: unknown; sceneId?: unknown } | undefined
): StudioScenePathParams | null {
  const sessionId = params?.sessionId
  const sceneId = params?.sceneId
  if (!isStudioEventScopeIdentifier(sessionId) || !isStudioEventScopeIdentifier(sceneId)) {
    return null
  }

  return { sessionId, sceneId }
}
