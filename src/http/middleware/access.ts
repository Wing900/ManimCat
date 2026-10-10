/**
 * Access 中间件
 *
 * 把一次请求的 Bearer 凭据解析成统一的 `AccessContext`，取代旧的环境变量白名单鉴权。
 * Route 只读 `res.locals.accessContext`。
 */

import type { Request, Response, NextFunction } from 'express'
import type { CustomApiConfig } from '../../types'
import { resolveRequestAccessContext } from '../../access'
import { extractBearerToken } from '../../utils/auth-utils'

const CONNECTION_MODE_HEADER = 'x-manimcat-connection'

export function accessMiddleware(req: Request, res: Response, next: NextFunction): void {
  resolveRequestAccessContext({
    credential: extractBearerToken(req.headers?.authorization),
    declaredMode: readHeader(req, CONNECTION_MODE_HEADER),
    requestProviderConfig: readRequestProviderConfig(req)
  })
    .then((accessContext) => {
      res.locals.accessContext = accessContext
      // Studio keeps reading a principal; deriving it from the same owner id keeps the two views
      // of the identity in step without Studio ever touching the credential.
      res.locals.studioPrincipal = { ownerId: accessContext.ownerId }
      next()
    })
    .catch(next)
}

function readHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name]

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (Array.isArray(value)) {
    const trimmed = value[0]?.trim()
    return trimmed || undefined
  }

  return undefined
}

function readRequestProviderConfig(req: Request): CustomApiConfig | undefined {
  const body = req.body as { providerConfig?: CustomApiConfig } | undefined
  return body?.providerConfig
}
