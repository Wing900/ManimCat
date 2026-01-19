/**
 * Authentication Middleware
 * Express middleware for API key authentication
 */

import type { Request, Response, NextFunction } from 'express'
import { createLogger } from '../utils/logger'
import { AuthenticationError } from '../utils/errors'

const logger = createLogger('AuthMiddleware')

/**
 * Extract API token from Authorization header
 */
function extractToken(authHeader: string | string[] | undefined): string {
  if (!authHeader) return ''

  if (typeof authHeader === 'string') {
    return authHeader.replace(/^Bearer\s+/i, '')
  }
  if (Array.isArray(authHeader)) {
    return authHeader[0]?.replace(/^Bearer\s+/i, '') || ''
  }
  return ''
}

/**
 * Authentication middleware
 * Validates Bearer token against MANIMGO_API_KEY and OPENAI_API_KEY
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const manimgoApiKey = process.env.MANIMGO_API_KEY
  const openaiApiKey = process.env.OPENAI_API_KEY

  // If no API key configured, skip authentication
  if (!manimgoApiKey && !openaiApiKey) {
    logger.debug('Auth middleware: no API key configured, skipping authentication')
    return next()
  }

  const authHeader = req.headers?.authorization
  if (!authHeader) {
    logger.warn('Auth middleware: missing authorization header', { path: req.path })
    throw new AuthenticationError('Missing API key. Provide Authorization header with Bearer token.')
  }

  const token = extractToken(authHeader)
  if (!token) {
    logger.warn('Auth middleware: invalid authorization header format', { path: req.path })
    throw new AuthenticationError('Invalid authorization header format. Use: Bearer <api-key>')
  }

  const validKeys = []
  if (manimgoApiKey) validKeys.push(manimgoApiKey)
  if (openaiApiKey) validKeys.push(openaiApiKey)

  const isValid = validKeys.some((key) => key === token)
  if (!isValid) {
    logger.warn('Auth middleware: invalid API key', {
      path: req.path,
      keyPrefix: token.slice(0, 4) + '...'
    })
    throw new AuthenticationError('Invalid API key')
  }

  logger.info('Auth middleware: authentication successful', {
    path: req.path,
    keyPrefix: token.slice(0, 4) + '...'
  })

  next()
}
