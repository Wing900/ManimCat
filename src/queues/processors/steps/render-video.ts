import fs from 'fs'
import os from 'os'
import path from 'path'
import { createLogger } from '../../../utils/logger'
import { cleanManimCode } from '../../../utils/manim-code-cleaner'
import { executeManimCommand, type ManimExecuteOptions } from '../../../utils/manim-executor'
import { findVideoFile } from '../../../utils/file-utils'
import { createRetryContext, executeCodeRetry } from '../../../services/code-retry/manager'
import { storeJobStage } from '../../../services/job-store'
import type { GenerationResult } from './analysis-step'
import type { PromptOverrides, VideoConfig } from '../../../types'
import type { RenderResult } from './render-step-types'

const logger = createLogger('RenderVideoStep')

export async function renderVideo(
  jobId: string,
  concept: string,
  quality: string,
  codeResult: GenerationResult,
  timings: Record<string, number>,
  customApiConfig?: unknown,
  videoConfig?: VideoConfig,
  promptOverrides?: PromptOverrides,
  onStageUpdate?: () => Promise<void>
): Promise<RenderResult> {
  const { manimCode, usedAI, generationType, sceneDesign } = codeResult

  const frameRate = videoConfig?.frameRate || 15
  const timeoutMs = (videoConfig?.timeout && videoConfig.timeout > 0 ? videoConfig.timeout : 600) * 1000

  logger.info('Rendering video', { jobId, quality, usedAI, frameRate, timeoutMs })

  const tempDir = path.join(os.tmpdir(), `manim-${jobId}`)
  const mediaDir = path.join(tempDir, 'media')
  const codeFile = path.join(tempDir, 'scene.py')
  const outputDir = path.join(process.cwd(), 'public', 'videos')

  try {
    fs.mkdirSync(tempDir, { recursive: true })
    fs.mkdirSync(mediaDir, { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })

    let lastRenderedCode = manimCode
    let lastRenderPeakMemoryMB = 0

    const renderCode = async (code: string): Promise<{
      success: boolean
      stderr: string
      stdout: string
      peakMemoryMB: number
    }> => {
      const cleaned = cleanManimCode(code)
      lastRenderedCode = cleaned.code

      if (cleaned.changes.length > 0) {
        logger.info('Manim code cleaned', {
          jobId,
          changes: cleaned.changes,
          originalLength: code.length,
          cleanedLength: cleaned.code.length
        })
      }

      fs.writeFileSync(codeFile, cleaned.code, 'utf-8')

      const options: ManimExecuteOptions = {
        jobId,
        quality,
        frameRate,
        format: 'mp4',
        sceneName: 'MainScene',
        tempDir,
        mediaDir,
        timeoutMs
      }

      const result = await executeManimCommand(codeFile, options)
      lastRenderPeakMemoryMB = result.peakMemoryMB
      return result
    }

    let finalCode = manimCode
    let renderResult: { success: boolean; stderr: string; stdout: string; peakMemoryMB: number }

    const hasSceneDesign = usedAI && !!sceneDesign
    if (hasSceneDesign) {
      logger.info('Using retry mechanism for video render', { jobId })
      await storeJobStage(jobId, 'generating')

      const retryContext = createRetryContext(concept, sceneDesign, promptOverrides)
      const retryManagerResult = await executeCodeRetry(retryContext, renderCode, customApiConfig)

      if (typeof retryManagerResult.generationTimeMs === 'number') {
        timings.retry = retryManagerResult.generationTimeMs
      }

      if (!retryManagerResult.success) {
        throw new Error(
          `Code retry failed after ${retryManagerResult.attempts} attempts: ${retryManagerResult.lastError}`
        )
      }

      finalCode = retryManagerResult.code
      renderResult = {
        success: true,
        stderr: '',
        stdout: '',
        peakMemoryMB: lastRenderPeakMemoryMB
      }
    } else {
      logger.info('Using single render attempt for video', {
        jobId,
        reason: usedAI ? 'no_scene_design' : 'not_ai_generated'
      })
      if (onStageUpdate) await onStageUpdate()
      renderResult = await renderCode(manimCode)
      if (!renderResult.success) {
        throw new Error(renderResult.stderr || 'Manim render failed')
      }
      finalCode = lastRenderedCode
    }

    const videoPath = findVideoFile(mediaDir, quality, frameRate)
    if (!videoPath) {
      throw new Error('Video file not found after render')
    }

    const outputFilename = `${jobId}.mp4`
    const outputPath = path.join(outputDir, outputFilename)
    fs.copyFileSync(videoPath, outputPath)

    return {
      jobId,
      concept,
      outputMode: 'video',
      manimCode: finalCode,
      usedAI,
      generationType,
      quality,
      videoUrl: `/videos/${outputFilename}`,
      renderPeakMemoryMB: renderResult.peakMemoryMB
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (error) {
      logger.warn('Cleanup failed', { jobId, error })
    }
  }
}
