/**
 * 认证中间件
 * Express API 密钥认证中间件
 */

import type { Request, Response, NextFunction } from 'express'
import { createLogger } from '../utils/logger'
import { AuthenticationError } from '../utils/errors'

const logger = createLogger('AuthMiddleware')

/**
 * 从 Authorization 头提取 API 令牌
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
 * 认证中间件
 * 验证 Bearer 令牌是否匹配 MANIMCAT_API_KEY 和 OPENAI_API_KEY
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const manimcatApiKey = process.env.MANIMCAT_API_KEY
  

  // 必须配置 ManimCat API 密钥
  if (!manimcatApiKey) {
    logger.warn('认证中间件：未配置 MANIMCAT_API_KEY，拒绝请求', { path: req.path })
    throw new AuthenticationError('服务未配置 MANIMCAT_API_KEY，无法访问接口')
  }

  const authHeader = req.headers?.authorization
  if (!authHeader) {
    logger.warn('认证中间件：缺少 authorization 头', { path: req.path })
    throw new AuthenticationError('缺少 API 密钥。请在 Authorization 头中提供 Bearer 令牌。')
  }

  const token = extractToken(authHeader)
  if (!token) {
    logger.warn('认证中间件：无效的 authorization 头格式', { path: req.path })
    throw new AuthenticationError('无效的 authorization 头格式。使用格式：Bearer <api-key>')
  }

  const isValid = manimcatApiKey === token
  if (!isValid) {
    logger.warn('认证中间令：无效的 API 密钥', {
      path: req.path,
      keyPrefix: token.slice(0, 4) + '...'
    })
    throw new AuthenticationError('无效的 API 密钥')
  }

  logger.info('认证中间令：认证成功', {
    path: req.path,
    keyPrefix: token.slice(0, 4) + '...'
  })

  next()
}
