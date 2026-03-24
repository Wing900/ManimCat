import { getStudioAuthHeaders, studioRequest } from './client'
import type {
  StudioCreateRunInput,
  StudioCreateSessionInput,
  StudioPermissionDecision,
  StudioPermissionMode,
  StudioPermissionRequest,
  StudioRun,
  StudioSession,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'

interface CreateSessionResponse {
  session: StudioSession
}

interface PatchSessionResponse {
  session: StudioSession
}

export interface CreateRunResponse extends Omit<StudioSessionSnapshot, 'session' | 'runs'> {
  run: StudioRun
  assistantMessage?: unknown
  text?: string
  pendingPermissions: StudioPermissionRequest[]
}

interface PendingPermissionsResponse {
  requests: StudioPermissionRequest[]
}

export async function createStudioSession(input: StudioCreateSessionInput): Promise<StudioSession> {
  const data = await studioRequest<CreateSessionResponse>('/sessions', {
    method: 'POST',
    headers: getStudioAuthHeaders('application/json'),
    body: JSON.stringify(input),
  })

  return data.session
}

export async function updateStudioSession(input: {
  sessionId: string
  permissionMode: StudioPermissionMode
}): Promise<StudioSession> {
  const data = await studioRequest<PatchSessionResponse>(`/sessions/${encodeURIComponent(input.sessionId)}`, {
    method: 'PATCH',
    headers: getStudioAuthHeaders('application/json'),
    body: JSON.stringify({ permissionMode: input.permissionMode }),
  })

  return data.session
}

export async function getStudioSessionSnapshot(sessionId: string): Promise<StudioSessionSnapshot> {
  return studioRequest<StudioSessionSnapshot>(`/sessions/${encodeURIComponent(sessionId)}`, {
    headers: getStudioAuthHeaders(),
  })
}

export async function createStudioRun(input: StudioCreateRunInput): Promise<CreateRunResponse> {
  return studioRequest<CreateRunResponse>('/runs', {
    method: 'POST',
    headers: getStudioAuthHeaders('application/json'),
    body: JSON.stringify(input),
  })
}

export async function getPendingStudioPermissions(): Promise<StudioPermissionRequest[]> {
  const data = await studioRequest<PendingPermissionsResponse>('/permissions/pending', {
    headers: getStudioAuthHeaders(),
  })

  return data.requests
}

export async function replyStudioPermission(input: {
  requestID: string
  reply: StudioPermissionDecision
  message?: string
  directory?: string
}): Promise<StudioPermissionRequest[]> {
  const data = await studioRequest<PendingPermissionsResponse>('/permissions/reply', {
    method: 'POST',
    headers: getStudioAuthHeaders('application/json'),
    body: JSON.stringify(input),
  })

  return data.requests
}
