import type { Response } from 'express'
import type { StudioScene, StudioSession } from '../../studio-agent/domain/types'
import { sendStudioError } from './studio-agent-responses'

/**
 * Authorizes one Scene-scoped request and collapses every inaccessible case into one public shape.
 *
 * An absent Session, an absent Scene, a foreign owner and a Scene belonging to another Session all
 * return the same `404 NOT_FOUND` body, so a caller cannot enumerate what exists. Lookup goes
 * through the Runtime/Scene service (no direct database access from a route), and the returned pair
 * is the trusted scope: the caller reuses this exact Session and Scene instead of reading the
 * Session a second time after admission.
 */
export async function resolveStudioSceneScope(input: {
  res: Response
  ownerId: string
  sessionId: string
  sceneId: string
  getScene: (ownerId: string, sceneId: string) => Promise<StudioScene | null>
  getSession: (ownerId: string, sessionId: string) => Promise<StudioSession | null>
}): Promise<{ session: StudioSession; scene: StudioScene } | null> {
  const { res, ownerId, sessionId, sceneId } = input

  let scene: StudioScene | null
  try {
    scene = await input.getScene(ownerId, sceneId)
  } catch {
    sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', 'Scene persistence is unavailable')
    return null
  }

  if (!scene || scene.sessionId !== sessionId) {
    sendStudioError(res, 404, 'NOT_FOUND', 'Scene not found', { sessionId, sceneId })
    return null
  }

  let session: StudioSession | null
  try {
    session = await input.getSession(ownerId, sessionId)
  } catch {
    sendStudioError(res, 503, 'SERVICE_UNAVAILABLE', 'Scene persistence is unavailable')
    return null
  }

  if (!session) {
    sendStudioError(res, 404, 'NOT_FOUND', 'Scene not found', { sessionId, sceneId })
    return null
  }

  return { session, scene }
}
