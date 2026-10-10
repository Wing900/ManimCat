/**
 * Error → HTTP response handler.
 *
 * Express error middleware (four-arg signature). Maps domain
 * AppError instances to their declared status code and logs
 * operational errors at INFO, unknown errors at ERROR + 500.
 */

import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../../shared/errors/errors'
import { logger } from '../../shared/logging/logger'

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isAppError = error instanceof AppError
  const statusCode = isAppError ? error.statusCode : 500
  const isOperational = isAppError ? error.isOperational : false
  const message = error instanceof Error ? error.message : 'Unknown error'

  if (isOperational) {
    logger.info('Operational error', {
      method: req.method,
      path: req.path,
      statusCode,
      message,
    })
  } else {
    logger.error('Unhandled error', {
      method: req.method,
      path: req.path,
      statusCode,
      error: error instanceof Error ? error : String(error),
    })
  }

  const details = isAppError ? error.details : undefined

  res.status(statusCode).json({
    error: message,
    ...(details ? { details } : {}),
  })
}
