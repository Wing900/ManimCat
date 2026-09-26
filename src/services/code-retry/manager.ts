import { createLogger } from '../../utils/logger'
import type {
  CodeRetryOptions,
  CodeRetryResult,
  RenderResult,
  RetryManagerResult,
  ChatMessage,
  CodeRetryContext,
  RetryCheckpoint
} from './types'
import type { OutputMode, PromptOverrides } from '../../types'
import { extractErrorContext, extractErrorMessage, getErrorType } from './utils'
import { retryCodeGeneration } from './code-generation'
import { JobCancelledError } from '../../utils/errors'
import { classifyRenderFailure } from './render-failure-policy'

const logger = createLogger('CodeRetryManager')

const MAX_RETRIES = parseInt(process.env.CODE_RETRY_MAX_RETRIES || '6', 10)

export function createRetryContext(
  concept: string,
  sceneDesign: string,
  promptOverrides?: PromptOverrides,
  outputMode: OutputMode = 'video'
): CodeRetryContext {
  return {
    concept,
    sceneDesign,
    outputMode,
    promptOverrides
  }
}

export { buildRetryFixPrompt } from './prompt-builder'

export async function executeCodeRetry(
  context: CodeRetryContext,
  renderer: (code: string) => Promise<RenderResult>,
  customApiConfig?: any,
  initialCode?: string,
  onRenderFailure?: (event: {
    attempt: number
    code: string
    codeSnippet?: string
    stderr: string
    stdout: string
    peakMemoryMB: number
    exitCode?: number
  }) => Promise<void> | void,
  onCheckpoint?: RetryCheckpoint
): Promise<RetryManagerResult> {
  logger.info('Starting code retry manager', {
    concept: context.concept,
    maxRetries: MAX_RETRIES
  })

  let generationTimeMs = 0
  let currentCode = initialCode?.trim() || ''
  if (!currentCode) {
    throw new Error('Code retry requires existing code; full regeneration mode is disabled')
  }

  if (onCheckpoint) {
    await onCheckpoint()
  }

  let renderResult = await renderer(currentCode)
  let currentCodeSnippet = renderResult.codeSnippet

  if (renderResult.success) {
    logger.info('Initial render succeeded')
    return { code: currentCode, success: true, attempts: 1, generationTimeMs }
  }

  if (onRenderFailure) {
    try {
      await onRenderFailure({
        attempt: 1,
        code: currentCode,
        codeSnippet: renderResult.codeSnippet,
        stderr: renderResult.stderr,
        stdout: renderResult.stdout,
        peakMemoryMB: renderResult.peakMemoryMB,
        exitCode: renderResult.exitCode
      })
    } catch (error) {
      logger.warn('onRenderFailure callback failed', { attempt: 1, error: String(error) })
    }
  }

  let errorMessage = extractErrorContext(renderResult.stderr)
  let errorType = getErrorType(renderResult.stderr)
  const failureDecision = classifyRenderFailure(renderResult.stderr)
  logger.warn('Initial render failed', { errorType, error: errorMessage })

  if (!failureDecision.allowAiRepair) {
    logger.warn('Skipping AI code retry for non-repairable render failure', {
      category: failureDecision.category,
      reason: failureDecision.reason
    })
    return {
      code: currentCode,
      success: false,
      attempts: 1,
      generationTimeMs,
      lastError: `${failureDecision.reason}: ${extractErrorMessage(renderResult.stderr)}`,
      failureCategory: failureDecision.category,
      retrySkipped: true
    }
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info('Starting retry patch attempt', {
      totalAttempts: attempt + 1,
      errorType,
      error: errorMessage
    })

    try {
      if (onCheckpoint) {
        await onCheckpoint()
      }

      const generationStart = Date.now()
      currentCode = await retryCodeGeneration(
        context,
        errorMessage,
        attempt,
        currentCode,
        currentCodeSnippet,
        customApiConfig,
        onCheckpoint
      )
      generationTimeMs += Date.now() - generationStart

      if (onCheckpoint) {
        await onCheckpoint()
      }

      renderResult = await renderer(currentCode)
      currentCodeSnippet = renderResult.codeSnippet

      if (renderResult.success) {
        logger.info('Retry render succeeded', { attempt: attempt + 1 })
        return { code: currentCode, success: true, attempts: attempt + 1, generationTimeMs }
      }

      if (onRenderFailure) {
        try {
          await onRenderFailure({
            attempt: attempt + 1,
            code: currentCode,
            codeSnippet: renderResult.codeSnippet || currentCode,
            stderr: renderResult.stderr,
            stdout: renderResult.stdout,
            peakMemoryMB: renderResult.peakMemoryMB,
            exitCode: renderResult.exitCode
          })
        } catch (error) {
          logger.warn('onRenderFailure callback failed', { attempt: attempt + 1, error: String(error) })
        }
      }

      errorMessage = extractErrorContext(renderResult.stderr)
      errorType = getErrorType(renderResult.stderr)
      logger.warn('Retry render failed', { attempt: attempt + 1, errorType, error: errorMessage })
    } catch (error) {
      if (error instanceof JobCancelledError) {
        logger.warn('Code retry aborted because job was cancelled', {
          attempt: attempt + 1,
          reason: error.details
        })
        throw error
      }

      logger.error('Retry patch process failed', { attempt: attempt + 1, error: String(error) })
    }
  }

  logger.error('All retry patch attempts failed', {
    totalAttempts: MAX_RETRIES + 1,
    finalError: extractErrorMessage(renderResult.stderr)
  })

  return {
    code: currentCode,
    success: false,
    attempts: MAX_RETRIES + 1,
    generationTimeMs,
    lastError: extractErrorMessage(renderResult.stderr)
  }
}

export type {
  CodeRetryOptions,
  CodeRetryResult,
  RenderResult,
  RetryManagerResult,
  ChatMessage,
  CodeRetryContext
} from './types'
