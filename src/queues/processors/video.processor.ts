/**
 * Video Processor
 * 任务处理器 - 主编排器
 */

import { videoQueue } from '../../config/bull'
import { storeJobResult } from '../../services/job-store'
import { clearJobCancelled } from '../../services/job-cancel-store'
import { JobCancelledError } from '../../utils/errors'
import { createLogger } from '../../utils/logger'
import type { VideoJobData } from '../../types'
import { runEditFlow, runGenerationFlow, runPreGeneratedFlow } from './video-processor-flows'
import { getRetryMeta, shouldDisableQueueRetry } from './video-processor-utils'

const logger = createLogger('VideoProcessor')

videoQueue.process(async (job) => {
  const data = job.data as VideoJobData
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

  try {
    if (preGeneratedCode) {
      const result = await runPreGeneratedFlow({ job, data, promptOverrides, timings })
      logger.info('Job completed (pre-generated code)', { jobId, timings })
      return result
    }

    if (editCode && editInstructions) {
      const result = await runEditFlow({ job, data, promptOverrides, timings })
      logger.info('Job completed', { jobId, source: 'ai-edit', timings })
      return result
    }

    const result = await runGenerationFlow({ job, data, promptOverrides, timings })
    logger.info('Job completed', { jobId, source: 'generation', timings })
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const cancelReason = error instanceof JobCancelledError ? error.details : undefined
    const retryMeta = getRetryMeta(job)
    const disableQueueRetry = shouldDisableQueueRetry(errorMessage)
    const willQueueRetry = !disableQueueRetry && retryMeta.hasRemainingAttempts

    if (disableQueueRetry) {
      try {
        job.discard()
        logger.warn('Queue retry disabled for exhausted code retry', {
          jobId,
          error: errorMessage,
          currentAttempt: retryMeta.currentAttempt,
          maxAttempts: retryMeta.maxAttempts
        })
      } catch (discardError) {
        logger.warn('Failed to discard job retry', { jobId, error: discardError })
      }
    }

    if (willQueueRetry) {
      logger.warn('Job attempt failed, Bull will retry', {
        jobId,
        error: errorMessage,
        currentAttempt: retryMeta.currentAttempt,
        maxAttempts: retryMeta.maxAttempts
      })
      throw error
    }

    logger.error('Job failed', {
      jobId,
      error: errorMessage,
      timings,
      currentAttempt: retryMeta.currentAttempt,
      maxAttempts: retryMeta.maxAttempts
    })

    await storeJobResult(jobId, {
      status: 'failed',
      data: { error: errorMessage, cancelReason, outputMode }
    })
    await clearJobCancelled(jobId)

    throw error
  }
})
