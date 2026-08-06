import type { ManimRenderPort } from './manim-render-port'
import { videoQueue } from '../../config/bull'
import { storeJobStage } from '../../services/job-store'
import { resolveJobTimeoutMs } from '../../utils/job-timeout'

export function createBullManimRenderPort(): ManimRenderPort {
  return {
    async submit(input) {
      await storeJobStage(input.jobId, 'rendering')
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

      return { jobId: input.jobId }
    }
  }
}
