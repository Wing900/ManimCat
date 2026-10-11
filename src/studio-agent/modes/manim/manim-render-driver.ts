import type { StudioRenderDriver, StudioRenderExecutionInput, StudioRenderExecutionResult } from '../../render/studio-render-driver'
import type { StudioRenderResultPort } from '../../render/render-result-port'
import type { ManimRenderPort } from './manim-render-port'

/**
 * Manim render driver: queues a Bull job, cancels it through the queue adapter, and
 * reconciles the result through the job-store port.
 */
export function createManimRenderDriver(options: {
  renderPort: ManimRenderPort
  resultPort: StudioRenderResultPort
}): StudioRenderDriver {
  const { renderPort, resultPort } = options

  return {
    kind: 'manim',
    async execute(input: StudioRenderExecutionInput): Promise<StudioRenderExecutionResult> {
      const jobId = input.render.jobId
      if (!jobId) {
        throw new Error('Manim render driver requires a render record with a jobId')
      }
      await renderPort.submit({
        jobId,
        concept: input.render.concept,
        code: input.code,
        outputMode: input.render.outputMode,
        quality: input.render.quality ?? 'medium',
        workspaceDirectory: input.workspaceDirectory,
        workspaceOutputDirectory: typeof input.render.metadata?.workspaceOutputDirectory === 'string'
          ? input.render.metadata.workspaceOutputDirectory : undefined,
        signal: input.signal,
      })
      return { jobId, status: 'queued' }
    },
    async cancel(jobId: string) {
      if (!renderPort.cancel) {
        throw new Error('Manim render cancellation is not configured')
      }
      return renderPort.cancel(jobId)
    },
    async reconcile(jobId: string) {
      return resultPort.getRenderResult(jobId)
    },
  }
}
