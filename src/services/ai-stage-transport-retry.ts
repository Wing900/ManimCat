import OpenAI from 'openai'
import { JobCancelledError } from '../utils/errors'

const RETRYABLE_ERROR_PATTERN = /(?:connection|econnreset|econnrefused|etimedout|socket hang up|fetch failed|network|timeout)/i

export interface AiStageTransportRetryEvent {
  attempt: number
  nextAttempt: number
  maxAttempts: number
  delayMs: number
  error: unknown
}

interface AiStageTransportRetryOptions {
  maxAttempts: number
  baseDelayMs?: number
  onCheckpoint?: () => Promise<void>
  onRetry?: (event: AiStageTransportRetryEvent) => void
}

export function isRetryableAiTransportError(error: unknown): boolean {
  if (error instanceof JobCancelledError) return false

  if (error instanceof OpenAI.APIError) {
    const status = error.status
    if (status === 408 || status === 409 || status === 429 || (typeof status === 'number' && status >= 500)) {
      return true
    }
    if (status === undefined && RETRYABLE_ERROR_PATTERN.test(`${error.name} ${error.code || ''} ${error.message}`)) {
      return true
    }
    return false
  }

  return error instanceof Error && RETRYABLE_ERROR_PATTERN.test(`${error.name} ${error.message}`)
}

export async function executeAiStageWithTransportRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: AiStageTransportRetryOptions,
): Promise<T> {
  const maxAttempts = Number.isFinite(options.maxAttempts)
    ? Math.max(1, Math.floor(options.maxAttempts))
    : 2
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_500)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.onCheckpoint) await options.onCheckpoint()

    try {
      return await operation(attempt)
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableAiTransportError(error)) throw error

      const delayMs = baseDelayMs * attempt
      options.onRetry?.({ attempt, nextAttempt: attempt + 1, maxAttempts, delayMs, error })
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new Error('AI stage transport retry exhausted')
}
