import type { Response } from 'express'
import type { AccessContext } from '../access'
import { AuthenticationError } from '../shared/errors/errors'

/**
 * The Route-side accessor for what `accessMiddleware` put on the response.
 *
 * Every protected Route starts with this call, so a Route mounted without the middleware fails
 * with a 401 naming the cause instead of running on an undefined context.
 */
export function requireAccessContext(res: Response): AccessContext {
  const context = res.locals.accessContext as AccessContext | undefined

  if (!context) {
    throw new AuthenticationError('访问上下文缺失：该路由未挂载 access 中间件')
  }

  return context
}
