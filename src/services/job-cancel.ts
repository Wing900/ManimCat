/**
 * Job Cancel Service
 * 任务取消逻辑
 */

import { videoQueue } from '../config/bull'
import { createLogger } from '../utils/logger'
import { JobCancelledError } from '../utils/errors'
import { getCancelReason, isJobCancelled, markJobCancelled } from './job-cancel-store'
import { cancelManimProcess } from '../utils/manim-process-registry'
import { deleteJobStage, getJobResult, storeJobResult } from './job-store'
import { createHistory } from '../database'
import type { OutputMode } from '../types'

const logger = createLogger('JobCancel')

async function stopDuplicateExecution(jobId: string, terminalStatus: 'completed' | 'failed'): Promise<void> {
  const duplicate = await videoQueue.getJob(jobId)
  if (!duplicate || await duplicate.getState() !== 'active') return

  await markJobCancelled(jobId, `Superseded by ${terminalStatus} result`)
  duplicate.discard()
  cancelManimProcess(jobId)
  logger.warn('Signaled duplicate active execution after terminal result', { jobId, terminalStatus })
}

export async function ensureJobNotCancelled(jobId: string, job?: { discard: () => void }): Promise<void> {
  if (!(await isJobCancelled(jobId))) {
    return
  }

  try {
    job?.discard()
  } catch (error) {
    logger.warn('Failed to discard cancelled job', { jobId, error })
  }

  const reason = await getCancelReason(jobId)
  throw new JobCancelledError('Job cancelled', reason || undefined)
}

export async function cancelJob(jobId: string): Promise<{ jobState: string | null }> {
  const existing = await getJobResult(jobId)
  if (existing?.status === 'completed') {
    await stopDuplicateExecution(jobId, 'completed')
    return { jobState: 'completed' }
  }
  if (existing?.status === 'failed') {
    await stopDuplicateExecution(jobId, 'failed')
    return { jobState: 'failed' }
  }

  const cancelReason = 'Cancelled by client'
  await markJobCancelled(jobId, cancelReason)

  let jobState: string | null = null
  let outputMode: OutputMode | undefined
  const job = await videoQueue.getJob(jobId)

  if (job) {
    jobState = await job.getState()
    const queueOutputMode = (job.data as { outputMode?: OutputMode } | undefined)?.outputMode
    if (queueOutputMode) {
      outputMode = queueOutputMode
    }

    if (jobState === 'waiting' || jobState === 'delayed') {
      await job.remove()
      logger.info('Removed pending job', { jobId, jobState })
    }

    if (jobState === 'active') {
      const killed = cancelManimProcess(jobId)
      logger.info('Signaled active job cancellation', { jobId, killed })
    }
  }

  await storeJobResult(jobId, {
    status: 'failed',
    data: { error: 'Job cancelled', cancelReason, outputMode }
  })

  await deleteJobStage(jobId)

  return { jobState }
}
