import type { Response } from 'express'

export type StudioApiErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PERMISSION_REJECTED'
  | 'WORK_CONFLICT'
  | 'UNSUPPORTED_TOOL'
  | 'SESSION_SYNC_FAILED'
  | 'INTERNAL_ERROR'

export interface StudioApiSuccess<T> {
  ok: true
  data: T
}

export interface StudioApiErrorResponse {
  ok: false
  error: {
    code: StudioApiErrorCode
    message: string
    details?: unknown
  }
}

export function createStudioSuccess<T>(data: T): StudioApiSuccess<T> {
  return {
    ok: true,
    data
  }
}

export function createStudioError(
  code: StudioApiErrorCode,
  message: string,
  details?: unknown
): StudioApiErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    }
  }
}

export function sendStudioSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json(createStudioSuccess(data))
}

export function sendStudioError(
  res: Response,
  status: number,
  code: StudioApiErrorCode,
  message: string,
  details?: unknown
): void {
  res.status(status).json(createStudioError(code, message, details))
}
