/**
 * Job Cancel Service
 * 任务取消逻辑
 */

import { videoQueue } from '../config/bull'
import { createLogger } from '../utils/logger'
import { JobCancelledError } from '../utils/errors'
import { clearJobCancelled, getCancelReason, isJobCancelled, markJobCancelled } from './job-cancel-store'
import { cancelManimProcess } from '../utils/manim-process-registry'
import { deleteJobStage, getJobResult, storeJobResult } from './job-store'

const logger = createLogger('JobCancel')
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
    return { jobState: 'completed' }
  }

  const cancelReason = 'Cancelled by client'
  await markJobCancelled(jobId, cancelReason)

  let jobState: string | null = null
  const job = await videoQueue.getJob(jobId)

  if (job) {
    jobState = await job.getState()

    if (jobState === 'waiting' || jobState === 'delayed') {
      await job.remove()
      await clearJobCancelled(jobId)
      logger.info('Removed pending job', { jobId, jobState })
    }

    if (jobState === 'active') {
      const killed = cancelManimProcess(jobId)
      logger.info('Signaled active job cancellation', { jobId, killed })
    }
  } else {
    await clearJobCancelled(jobId)
  }

  if (!existing || existing.status != 'failed') {
    await storeJobResult(jobId, {
      status: 'failed',
      data: { error: 'Job cancelled', cancelReason }
    })
  }

  await deleteJobStage(jobId)

  return { jobState }
}
