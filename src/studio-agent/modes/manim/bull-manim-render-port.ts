import type { ManimRenderPort } from './manim-render-port'
import { videoQueue } from '../../../config/bull'
import { getJobResult, storeJobStage } from '../../../services/job-store'
import { resolveJobTimeoutMs } from '../../../utils/job-timeout'
import { cancelJob } from '../../../services/job-cancel'
import { throwIfStudioRunCancelled } from '../../runtime/execution/run-cancellation'

export function createBullManimRenderPort(): ManimRenderPort {
  return {
    async cancel(jobId) {
      const result = await cancelJob(jobId)
      if (result.jobState === 'failed') {
        const stored = await getJobResult(jobId)
        if (stored?.status === 'failed' && stored.data.cancelReason) return 'cancelled'
      }
      return result.jobState === 'completed' || result.jobState === 'failed' ? result.jobState : 'cancelled'
    },
    async submit(input) {
      throwIfStudioRunCancelled(input.signal)
      await storeJobStage(input.jobId, 'rendering')
      throwIfStudioRunCancelled(input.signal)
      await videoQueue.add(
        {
          jobId: input.jobId,
          concept: input.concept,
          outputMode: input.outputMode,
          quality: input.quality,
          preGeneratedCode: input.code,
          timestamp: new Date().toISOString(),
          workspaceDirectory: input.workspaceDirectory
        },
        {
          jobId: input.jobId,
          timeout: resolveJobTimeoutMs()
        }
      )

      // A stop can race queue.add. The durable job marker also covers another Worker replica.
      if (input.signal?.aborted) {
        await cancelJob(input.jobId)
        throwIfStudioRunCancelled(input.signal)
      }

      return { jobId: input.jobId }
    }
  }
}
