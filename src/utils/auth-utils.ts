import type { Request } from 'express'
import { AuthenticationError } from './errors'
import { getAllowedManimcatApiKeys, hasManimcatApiKey } from './manimcat-auth'

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
  const keys = getAllowedManimcatApiKeys()
  if (keys.length === 0) {
    throw new AuthenticationError('Prompt overrides require MANIMCAT_API_KEY or MANIMCAT_API_KEYS to be set.')
  }

  const token = extractBearerToken(req.headers?.authorization)
  if (!token || !hasManimcatApiKey(token)) {
    throw new AuthenticationError('Prompt overrides require a valid ManimCat API key token.')
  }
}
