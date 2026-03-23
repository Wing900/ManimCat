import { createLogger } from '../../../utils/logger'
import type { GenerationResult } from './analysis-step'
import type { OutputMode, VideoJobData } from '../../../types'
import { renderVideo } from './render-video'
import { renderImages } from './render-images'
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

  const renderStart = Date.now()
  const codeResult: GenerationResult = {
    manimCode: preGeneratedCode,
    usedAI: false,
    generationType: 'custom-api'
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
          jobData.renderCacheKey
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
          jobData.renderCacheKey
        )

  timings.render = Date.now() - renderStart

  logger.info('Job completed (pre-generated code)', { jobId, outputMode, timings })
  return renderResult
}

export { renderVideo, renderImages }
