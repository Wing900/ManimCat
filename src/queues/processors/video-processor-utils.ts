import type { ProcessingStage } from '../../types'

export function shouldDisableQueueRetry(errorMessage: string): boolean {
  return errorMessage.includes('Code retry failed after')
}

export function getRetryMeta(job: any): {
  currentAttempt: number
  maxAttempts: number
  hasRemainingAttempts: boolean
} {
  const maxAttempts = typeof job?.opts?.attempts === 'number' && job.opts.attempts > 0 ? job.opts.attempts : 1
  const currentAttempt = (job?.attemptsMade ?? 0) + 1
  return {
    currentAttempt,
    maxAttempts,
    hasRemainingAttempts: currentAttempt < maxAttempts
  }
}

export async function storeProcessingStage(jobId: string, stage: ProcessingStage): Promise<void> {
  const { storeJobStage } = await import('../../services/job-store')
  await storeJobStage(jobId, stage)
}
