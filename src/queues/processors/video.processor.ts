/**
 * Video Processor
 * 任务处理器 - 主编排器
 */

import { videoQueue } from '../../config/bull'
import { storeJobResult, touchJobTracking } from '../../services/job-store'
import { clearJobCancelled } from '../../services/job-cancel-store'
import { createHistory } from '../../database'
import { JobCancelledError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import type { VideoJobData } from '../../types'
import { runEditFlow, runGenerationFlow, runPreGeneratedFlow } from './video-processor-flows-static'
import { getRetryMeta, shouldDisableQueueRetry, storeProcessingStage } from './video-processor-utils'
import { getCurrentJobLogSummary, runWithJobLogContext } from '../../services/job-log-context'

const logger = createLogger('VideoProcessor')
const activeExecutions = new Map<string, Promise<unknown>>()
const JOB_HEARTBEAT_MS = 15_000

function emitJobSummary(args: {
  jobId: string
  taskType: 'pre-generated' | 'ai-edit' | 'generation'
  result: 'completed' | 'failed'
  outputMode: string
  timings?: Record<string, number>
  renderPeakMemoryMB?: number
  error?: string
  attempt?: number
  maxAttempts?: number
}): void {
  const tokenSummary = getCurrentJobLogSummary()
  logger.info('job_summary', {
    _logType: 'job_summary',
    jobId: args.jobId,
    taskType: args.taskType,
    result: args.result,
    outputMode: args.outputMode,
    attempt: args.attempt,
    maxAttempts: args.maxAttempts,
    timings: args.timings,
    renderPeakMemoryMB: args.renderPeakMemoryMB,
    error: args.error,
    tokens: tokenSummary
      ? {
          totals: tokenSummary.totals,
          calls: tokenSummary.calls
        }
      : {
          totals: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            measuredCalls: 0,
            unmeasuredCalls: 0
          },
          calls: []
        }
  })
}

async function executeVideoJob(job: any): Promise<unknown> {
  const data = job.data as VideoJobData
  const contextAttempt = typeof job.attemptsMade === 'number' ? job.attemptsMade + 1 : 1

  return runWithJobLogContext(
    {
      jobId: data.jobId,
      outputMode: data.outputMode || 'video',
      attempts: contextAttempt
    },
    async () => {
  const {
    jobId,
    concept,
    quality,
    outputMode = 'video',
    preGeneratedCode,
    editCode,
    editInstructions,
    promptOverrides,
    referenceImages
  } = data

  logger.info('Processing video job', {
    jobId,
    concept,
    outputMode,
    quality,
    hasPreGeneratedCode: !!preGeneratedCode,
    hasEditRequest: !!editInstructions,
    referenceImageCount: referenceImages?.length || 0
  })

  const timings: Record<string, number> = {}
  const retryMeta = getRetryMeta(job)
  const initialStage = preGeneratedCode ? 'rendering' : 'generating'

  try {
    await storeProcessingStage(jobId, initialStage, { attempt: retryMeta.currentAttempt })

    if (preGeneratedCode) {
      const result = await runPreGeneratedFlow({ job, data, promptOverrides, timings })
      logger.info('Job completed (pre-generated code)', { jobId, timings })
      emitJobSummary({
        jobId,
        taskType: 'pre-generated',
        result: 'completed',
        outputMode,
        timings,
        renderPeakMemoryMB: result.renderPeakMemoryMB,
        attempt: retryMeta.currentAttempt,
        maxAttempts: retryMeta.maxAttempts
      })
      return result
    }

    if (editCode && editInstructions) {
      const result = await runEditFlow({ job, data, promptOverrides, timings })
      logger.info('Job completed', { jobId, source: 'ai-edit', timings })
      emitJobSummary({
        jobId,
        taskType: 'ai-edit',
        result: 'completed',
        outputMode,
        timings,
        renderPeakMemoryMB: result.renderPeakMemoryMB,
        attempt: retryMeta.currentAttempt,
        maxAttempts: retryMeta.maxAttempts
      })
      return result
    }

    const result = await runGenerationFlow({ job, data, promptOverrides, timings })
    logger.info('Job completed', { jobId, source: 'generation', timings })
    emitJobSummary({
      jobId,
      taskType: 'generation',
      result: 'completed',
      outputMode,
      timings,
      renderPeakMemoryMB: result.renderPeakMemoryMB,
      attempt: retryMeta.currentAttempt,
      maxAttempts: retryMeta.maxAttempts
    })
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const cancelReason = error instanceof JobCancelledError ? error.details : undefined
    const currentRetryMeta = getRetryMeta(job)
    const disableQueueRetry = shouldDisableQueueRetry(errorMessage)
    const willQueueRetry = !disableQueueRetry && currentRetryMeta.hasRemainingAttempts

    if (disableQueueRetry) {
      try {
        job.discard()
        logger.warn('Queue retry disabled for exhausted code retry', {
          jobId,
          error: errorMessage,
          currentAttempt: currentRetryMeta.currentAttempt,
          maxAttempts: currentRetryMeta.maxAttempts
        })
      } catch (discardError) {
        logger.warn('Failed to discard job retry', { jobId, error: discardError })
      }
    }

    if (willQueueRetry) {
      logger.warn('Job attempt failed, Bull will retry', {
        jobId,
        error: errorMessage,
        currentAttempt: currentRetryMeta.currentAttempt,
        maxAttempts: currentRetryMeta.maxAttempts
      })
      throw error
    }

    logger.error('Job failed', {
      jobId,
      error: errorMessage,
      timings,
      currentAttempt: currentRetryMeta.currentAttempt,
      maxAttempts: currentRetryMeta.maxAttempts
    })

    const storeOutcome = await storeJobResult(jobId, {
      status: 'failed',
      data: { error: errorMessage, cancelReason, outputMode }
    })
    if (!cancelReason) {
      await clearJobCancelled(jobId)
    }

    if (storeOutcome === 'preserved-completed') {
      logger.warn('Duplicate execution failed after a completed result; preserving success', {
        jobId,
        error: errorMessage,
        currentAttempt: currentRetryMeta.currentAttempt,
      })
      return {
        success: true,
        source: 'preserved-completed-result',
      }
    }

    // 写入持久化历史记录（保存错误原因和提示词）
    if (data.clientId && storeOutcome === 'stored') {
      try {
        await createHistory({
          client_id: data.clientId,
          prompt: concept,
          code: null,  // 失败时没有代码
          output_mode: outputMode as 'video' | 'image',
          quality: quality as 'low' | 'medium' | 'high',
          status: 'failed',
          error: errorMessage
        })
      } catch (histErr) {
        logger.warn('Failed to write history record', { jobId, error: histErr })
      }
    }

    emitJobSummary({
      jobId,
      taskType: editCode && editInstructions ? 'ai-edit' : preGeneratedCode ? 'pre-generated' : 'generation',
      result: 'failed',
      outputMode,
      timings,
      error: errorMessage,
      attempt: currentRetryMeta.currentAttempt,
      maxAttempts: currentRetryMeta.maxAttempts
    })

    throw error
  }
    }
  )
}

videoQueue.process(async (job) => {
  const data = job.data as VideoJobData
  const jobId = data.jobId || String(job.id)
  const activeExecution = activeExecutions.get(jobId)

  if (activeExecution) {
    logger.warn('Duplicate Bull execution joined the existing in-process job', {
      jobId,
      attemptsMade: job.attemptsMade,
    })
    return activeExecution
  }

  const execution = executeVideoJob(job)
  activeExecutions.set(jobId, execution)
  const heartbeat = setInterval(() => {
    void touchJobTracking(jobId, (job.attemptsMade ?? 0) + 1)
  }, JOB_HEARTBEAT_MS)
  heartbeat.unref()

  try {
    return await execution
  } finally {
    clearInterval(heartbeat)
    if (activeExecutions.get(jobId) === execution) {
      activeExecutions.delete(jobId)
    }
  }
})
