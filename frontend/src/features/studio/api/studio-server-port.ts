import type { StudioRequestOptions } from './studio-agent-api'
import {
  cancelStudioRun,
  createStudioScene,
  createStudioSceneRun,
  createStudioSession,
  deleteStudioSession,
  getStudioSceneSnapshot,
  getStudioSessionSnapshot,
  reorderStudioScenes,
} from './studio-agent-api'
import type { StudioCinemaCancelResponse } from '../cinema/cinema-controller'
import type {
  StudioCreateSceneRunInput,
  StudioCreateSceneRunResponse,
  StudioCreateSessionInput,
  StudioScene,
  StudioSceneSnapshot,
  StudioSession,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'

/**
 * The one mapping from the Studio ports to HTTP.
 *
 * The Cinema needs this transport at two levels — the Session gateway's three methods and the Scene
 * controller's six — and the hosted shape needs nothing else. Both of those interfaces are satisfied
 * by this single object, so each assembly point hands it out directly instead of keeping its own copy
 * of the same eight calls.
 */
export interface StudioServerPort {
  createSession: (input: StudioCreateSessionInput) => Promise<StudioSession>
  getSessionSnapshot: (sessionId: string, options?: StudioRequestOptions) => Promise<StudioSessionSnapshot>
  deleteSession: (sessionId: string) => Promise<boolean>
  createScene: (sessionId: string, options?: StudioRequestOptions) => Promise<StudioScene>
  reorderScenes: (sessionId: string, sceneIds: string[]) => Promise<StudioScene[]>
  getSceneSnapshot: (
    sessionId: string,
    sceneId: string,
    options?: StudioRequestOptions
  ) => Promise<StudioSceneSnapshot>
  createSceneRun: (
    sessionId: string,
    sceneId: string,
    input: StudioCreateSceneRunInput,
    options?: StudioRequestOptions
  ) => Promise<StudioCreateSceneRunResponse>
  cancelRun: (runId: string) => Promise<StudioCinemaCancelResponse>
}

export const studioServerPort: StudioServerPort = {
  createSession: (input) => createStudioSession(input),
  getSessionSnapshot: (sessionId, options) => getStudioSessionSnapshot(sessionId, options),
  deleteSession: (sessionId) => deleteStudioSession(sessionId),
  createScene: (sessionId, options) => createStudioScene(sessionId, options),
  reorderScenes: (sessionId, sceneIds) => reorderStudioScenes(sessionId, sceneIds),
  getSceneSnapshot: (sessionId, sceneId, options) => getStudioSceneSnapshot(sessionId, sceneId, options),
  createSceneRun: (sessionId, sceneId, input, options) =>
    createStudioSceneRun(sessionId, sceneId, input, options),
  // Preserve property presence: an absent Run is the status-only compatibility shape; explicitly
  // supplied malformed/null Runs must still reach the verdict as rejected.
  cancelRun: (runId) => cancelStudioRun({ runId }),
}
