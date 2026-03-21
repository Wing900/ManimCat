import type { StudioApiEnvelope } from '../protocol/studio-agent-types'

const STUDIO_API_BASE = '/api/studio-agent'

export class StudioApiRequestError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(message: string, code = 'STUDIO_REQUEST_FAILED', details?: unknown) {
    super(message)
    this.name = 'StudioApiRequestError'
    this.code = code
    this.details = details
  }
}

export function getStudioApiBase(): string {
  return STUDIO_API_BASE
}

export function getStudioAuthHeaders(contentType?: string): HeadersInit {
  const headers: HeadersInit = {}
  if (contentType) {
    headers['Content-Type'] = contentType
  }

  const apiKey = localStorage.getItem('manimcat_api_key')
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  return headers
}

export async function studioRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${STUDIO_API_BASE}${path}`, init)
  const payload = await parseStudioEnvelope<T>(response)

  if (!response.ok || !payload.ok) {
    if (payload.ok) {
      throw new StudioApiRequestError(`Studio request failed with status ${response.status}`)
    }

    throw new StudioApiRequestError(payload.error.message, payload.error.code, payload.error.details)
  }

  return payload.data
}

async function parseStudioEnvelope<T>(response: Response): Promise<StudioApiEnvelope<T>> {
  try {
    return (await response.json()) as StudioApiEnvelope<T>
  } catch {
    throw new StudioApiRequestError(`Studio API returned invalid JSON (${response.status})`)
  }
}
