import { createHash } from 'node:crypto'
import type { Response } from 'express'
import { AuthenticationError } from '../../utils/errors'
import type { StudioPrincipal } from '../domain/types'

/**
 * Convert an API token into the stable, non-secret identity used by Studio.
 * The raw token remains available only to the routing layer that needs it to
 * resolve a provider configuration.
 */
export function createStudioPrincipal(token: string): StudioPrincipal {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    throw new AuthenticationError('Studio authentication requires a non-empty token')
  }

  return {
    ownerId: createHash('sha256').update(normalizedToken).digest('hex').slice(0, 32),
  }
}

export function requireStudioPrincipal(res: Response): StudioPrincipal {
  const principal = res.locals.studioPrincipal as StudioPrincipal | undefined
  if (!principal?.ownerId) {
    throw new AuthenticationError('Studio authentication context is missing')
  }
  return principal
}
