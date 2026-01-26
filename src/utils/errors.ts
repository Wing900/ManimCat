/**
 * Error Utilities
 * 统一错误处理工具
 */

import type { ErrorResponse } from '../types'

/**
 * 应用错误基类
 */
export class AppError extends Error {
  public readonly statusCode: number
  public readonly isOperational: boolean
  public readonly details?: any

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: any
  ) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = isOperational
    this.details = details

    // 维护正确的原型链
    Object.setPrototypeOf(this, new.target.prototype)
    Error.captureStackTrace(this)
  }

  /**
   * 转换为 API 错误响应
   */
  toJSON(): ErrorResponse {
    return {
      error: this.message,
      details: this.details,
      statusCode: this.statusCode
    }
  }
}

/**
 * 验证错误（400）
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, true, details)
    this.name = 'ValidationError'
  }
}

/**
 * 未找到错误（404）
 */
export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', details?: any) {
    super(message, 404, true, details)
    this.name = 'NotFoundError'
  }
}

/**
 * 认证错误（401）
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', details?: any) {
    super(message, 401, true, details)
    this.name = 'AuthenticationError'
  }
}

/**
 * 权限错误（403）
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Access forbidden', details?: any) {
    super(message, 403, true, details)
    this.name = 'ForbiddenError'
  }
}

/**
 * 冲突错误（409）
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 409, true, details)
    this.name = 'ConflictError'
  }
}

/**
 * 内部服务器错误（500）
 */
export class InternalError extends AppError {
  constructor(message: string = 'Internal server error', details?: any) {
    super(message, 500, false, details)
    this.name = 'InternalError'
  }
}

/**
 * 服务不可用错误（503）
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable', details?: any) {
    super(message, 503, true, details)
    this.name = 'ServiceUnavailableError'
  }
}

/**
 * 超时错误（504）
 */
export class TimeoutError extends AppError {
  constructor(message: string = 'Request timeout', details?: any) {
    super(message, 504, true, details)
    this.name = 'TimeoutError'
  }
}

/**
 * 判断是否为应用错误
 */
export function isAppError(error: any): error is AppError {
  return error instanceof AppError
}

/**
 * 判断是否为操作性错误（可恢复）
 */
export function isOperationalError(error: any): boolean {
  if (isAppError(error)) {
    return error.isOperational
  }
  return false
}

/**
 * 格式化错误信息
 */
export function formatError(error: any): ErrorResponse {
  if (isAppError(error)) {
    return error.toJSON()
  }

  // 处理 Zod 验证错误
  if (error.name === 'ZodError') {
    return {
      error: 'Validation failed',
      details: error.errors,
      statusCode: 400
    }
  }

  // 默认错误
  return {
    error: error.message || 'Internal server error',
    statusCode: 500
  }
}

/**
 * 从错误中提取状态码
 */
export function getStatusCode(error: any): number {
  if (isAppError(error)) {
    return error.statusCode
  }
  if (error.name === 'ZodError') {
    return 400
  }
  return 500
}