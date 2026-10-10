import { StudioApiRequestError, getStudioAuthHeaders, studioRequest } from './client'
import type {
  StudioCreateRunInput,
  StudioCreateSceneRunInput,
  StudioCreateSceneRunResponse,
  StudioCreateSessionInput,
  StudioRun,
  StudioScene,
  StudioSceneSnapshot,
  StudioSession,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'

/**
 * Optional request options. Every Scene call accepts an `AbortSignal` so a Session switch can drop
 * a response that is no longer needed; the parameter is optional, so the existing call sites stay
 * valid and keep their exact behavior.
 */
export interface StudioRequestOptions {
  signal?: AbortSignal
}

interface CreateSessionResponse {
  session: StudioSession
}

export interface CreateRunResponse extends Omit<StudioSessionSnapshot, 'session'> {
  run: StudioRun
  assistantMessage?: unknown
  text?: string
}

interface CancelRunResponse {
  run?: StudioRun
  status: 'cancelled' | 'completed' | 'failed' | 'running' | 'pending'
  message: string
}

export async function createStudioSession(input: StudioCreateSessionInput): Promise<StudioSession> {
  const data = await studioRequest<CreateSessionResponse>('/sessions', {
    method: 'POST',
    headers: getStudioAuthHeaders('application/json'),
    body: JSON.stringify(input),
  })

  return data.session
}

/**
 * Session snapshot. The optional `signal` lets a Session switch drop a response nobody needs any
 * more; the parameter is optional, so every existing call site keeps its exact behavior.
 */
export async function getStudioSessionSnapshot(
  sessionId: string,
  options?: StudioRequestOptions,
): Promise<StudioSessionSnapshot> {
  return studioRequest<StudioSessionSnapshot>(`/sessions/${encodeURIComponent(sessionId)}`, {
    headers: getStudioAuthHeaders(),
    signal: options?.signal,
  })
}

/**
 * Delete one Session and everything that points at it (the schema cascades: Scenes, messages, parts,
 * Runs, renders, session events). An answer of `NOT_FOUND` means the Session is already gone for this
 * owner, which is the outcome the caller wanted, so it resolves `true` too and a stale local id can
 * still be forgotten. Any other failure rejects, and the caller keeps its entry.
 */
export async function deleteStudioSession(sessionId: string): Promise<boolean> {
  try {
    const data = await studioRequest<{ deleted: boolean }>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        headers: getStudioAuthHeaders('application/json'),
      },
    )
    return data.deleted === true
  } catch (error) {
    if (error instanceof StudioApiRequestError && error.code === 'NOT_FOUND') {
      return true
    }
    throw error
  }
}

/**
 * One Scene and only its own records. An absent, foreign, or foreign-Session Scene all arrive
 * as the same 404, so callers cannot tell them apart.
 */
export async function getStudioSceneSnapshot(
  sessionId: string,
  sceneId: string,
  options?: StudioRequestOptions,
): Promise<StudioSceneSnapshot> {
  return studioRequest<StudioSceneSnapshot>(
    `/sessions/${encodeURIComponent(sessionId)}/scenes/${encodeURIComponent(sceneId)}`,
    {
      headers: getStudioAuthHeaders(),
      signal: options?.signal,
    },
  )
}

interface CreateSceneResponse {
  scene: StudioScene
}

interface ReorderScenesResponse {
  scenes: StudioScene[]
}

/**
 * Append one Scene to a Session. Position and source path are server decisions: the body is empty
 * and never carries an identity, a directory or a file path.
 */
export async function createStudioScene(
  sessionId: string,
  options?: StudioRequestOptions,
): Promise<StudioScene> {
  const data = await studioRequest<CreateSceneResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/scenes`,
    {
      method: 'POST',
      headers: getStudioAuthHeaders('application/json'),
      body: JSON.stringify({}),
      signal: options?.signal,
    },
  )

  return data.scene
}

/**
 * Replace the Scene order of a Session. The order must name exactly the persisted Scene set, so a
 * rejected request is a conflict and never a partial reorder.
 */
export async function reorderStudioScenes(
  sessionId: string,
  sceneIds: string[],
  options?: StudioRequestOptions,
): Promise<StudioScene[]> {
  const data = await studioRequest<ReorderScenesResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/scenes/order`,
    {
      method: 'PUT',
      headers: getStudioAuthHeaders('application/json'),
      body: JSON.stringify({ sceneIds }),
      signal: options?.signal,
    },
  )

  return data.scenes
}

export async function createStudioRun(input: StudioCreateRunInput): Promise<CreateRunResponse> {
  return studioRequest<CreateRunResponse>('/runs', {
    method: 'POST',
    headers: getStudioAuthHeaders('application/json'),
    body: JSON.stringify(input),
  })
}

/** Nested Scene Run path: Session and Scene identity live in the URL, never in the body. */
export function buildStudioSceneRunPath(sessionId: string, sceneId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}/scenes/${encodeURIComponent(sceneId)}/runs`
}

/**
 * Start a Run for one Scene. The response carries only that Scene's records plus the accepted Run,
 * so a Scene client never receives sibling messages, Runs or renders.
 */
export async function createStudioSceneRun(
  sessionId: string,
  sceneId: string,
  input: StudioCreateSceneRunInput,
  options?: StudioRequestOptions,
): Promise<StudioCreateSceneRunResponse> {
  return studioRequest<StudioCreateSceneRunResponse>(buildStudioSceneRunPath(sessionId, sceneId), {
    method: 'POST',
    headers: getStudioAuthHeaders('application/json'),
    body: JSON.stringify(input),
    signal: options?.signal,
  })
}

export async function cancelStudioRun(input: {
  runId: string
  reason?: string
}): Promise<CancelRunResponse> {
  return studioRequest<CancelRunResponse>(`/runs/${encodeURIComponent(input.runId)}/cancel`, {
    method: 'POST',
    headers: getStudioAuthHeaders('application/json'),
    body: JSON.stringify({ reason: input.reason }),
  })
}