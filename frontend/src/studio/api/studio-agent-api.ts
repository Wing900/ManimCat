import { getStudioAuthHeaders, studioRequest } from './client'
import type {
  StudioCreateRunInput,
  StudioCreateSessionInput,
  StudioRun,
  StudioSession,
  StudioSessionSnapshot,
} from '../protocol/studio-agent-types'

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