import type { Request } from 'express'
import { AuthenticationError } from './errors'

export function extractBearerToken(authHeader: string | string[] | undefined): string {
  if (!authHeader) return ''

  if (typeof authHeader === 'string') {
    return authHeader.replace(/^Bearer\s+/i, '')
  }

  if (Array.isArray(authHeader)) {
    return authHeader[0]?.replace(/^Bearer\s+/i, '') || ''
  }

  return ''
}

export function requirePromptOverrideAuth(req: Pick<Request, 'headers'>): void {
  const manimcatApiKey = process.env.MANIMCAT_API_KEY
  if (!manimcatApiKey) {
    throw new AuthenticationError('Prompt overrides require MANIMCAT_API_KEY to be set.')
  }

  const token = extractBearerToken(req.headers?.authorization)
  if (!token || token !== manimcatApiKey) {
    throw new AuthenticationError('Prompt overrides require a valid MANIMCAT_API_KEY token.')
  }
}
