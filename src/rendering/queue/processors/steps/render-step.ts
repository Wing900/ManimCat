import { createLogger } from '../../../../shared/logging/logger'
import type { GenerationResult } from './analysis-step'
import type { OutputMode, VideoJobData } from '../../../../types'
import { renderVideo } from './render-video'
import { renderImages } from './render-images'
import { resolveReusedNarrationForJob } from '../../../manim/narration-reuse'
import type { RenderResult } from './render-step-types'

const logger = createLogger('RenderStep')

export type { RenderResult } from './render-step-types'

export async function handlePreGeneratedCode(
  jobId: string,
  concept: string,
  quality: string,
  outputMode: OutputMode,
  preGeneratedCode: string,
  timings: Record<string, number>,
  jobData: VideoJobData
): Promise<RenderResult> {
  logger.info('Using pre-generated code from frontend', {
    jobId,
    outputMode,
    codeLength: preGeneratedCode.length,
    hasCustomApi: !!jobData.customApiConfig
  })

  // A code-modal edit or quality change arrives as a new job id with the same renderCacheKey.
  // Reuse the server-published voice track instead of silently rendering a silent video.
  const reusedNarration = resolveReusedNarrationForJob({
    renderCacheKey: jobData.renderCacheKey,
    workspaceDirectory: jobData.workspaceDirectory,
    jobId,
    videoConfig: jobData.videoConfig,
    outputMode
  })

  const codeResult: GenerationResult = {
    code: preGeneratedCode,
    usedAI: false,
    generationType: 'custom-api',
    narration: reusedNarration
  }

  const renderResult =
    outputMode === 'image'
      ? await renderImages(
          jobId,
          concept,
          quality,
          codeResult,
          timings,
          jobData.videoConfig,
          jobData.customApiConfig,
          jobData.promptOverrides,
          undefined,
          jobData.clientId,
          jobData.workspaceDirectory,
          jobData.renderCacheKey,
          jobData.workspaceOutputDirectory
        )
      : await renderVideo(
          jobId,
          concept,
          quality,
          codeResult,
          timings,
          jobData.customApiConfig,
          jobData.videoConfig,
          jobData.promptOverrides,
          undefined,
          jobData.clientId,
          jobData.workspaceDirectory,
          jobData.renderCacheKey,
          jobData.workspaceOutputDirectory,
          jobData.sceneName
        )

  logger.info('Job completed (pre-generated code)', { jobId, outputMode, timings })
  return renderResult
}

export { renderVideo, renderImages }

