/**
 * Error Handler Middleware
 * Express 错误处理中间件
 */

import type { Request, Response, NextFunction } from 'express'
import { formatError, getStatusCode, isOperationalError } from '../utils/errors'
import { logger } from '../utils/logger'

/**
 * 错误处理中间件
 */
export function errorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 记录错误日志
  const statusCode = getStatusCode(error)
  const isOperational = isOperationalError(error)

  if (isOperational) {
    // 操作性错误（预期错误）- INFO 级别
    logger.info('Operational error occurred', {
      method: req.method,
      path: req.path,
      statusCode,
      error: error.message,
      stack: error.stack
    })
  } else {
    // 编程错误（未预期错误）- ERROR 级别
    logger.error('Programming error occurred', {
      method: req.method,
      path: req.path,
      statusCode,
      error: error.message,
      stack: error.stack
    })
  }

  // 格式化错误响应
  const errorResponse = formatError(error)

  // 发送错误响应
  res.status(statusCode).json(errorResponse)
}

/**
 * 404 未找到处理中间件
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  })
}

/**
 * 异步路由错误捕获包装器
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}