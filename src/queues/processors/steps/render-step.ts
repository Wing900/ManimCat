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
import type { PromptOverrides, VideoConfig, VideoJobData } from '../../../types'

const logger = createLogger('RenderStep')

export interface RenderResult {
  jobId: string
  concept: string
  manimCode: string
  usedAI: boolean
  generationType: string
  quality: string
  videoUrl: string
  renderPeakMemoryMB?: number
}
/**
 * 娓叉煋瑙嗛
 */
export async function renderVideo(
  jobId: string,
  concept: string,
  quality: string,
  codeResult: GenerationResult,
  timings: Record<string, number>,
  customApiConfig?: any,
  videoConfig?: VideoConfig,
  promptOverrides?: PromptOverrides,
  onStageUpdate?: () => Promise<void>
): Promise<RenderResult> {
  const { manimCode, usedAI, generationType, sceneDesign } = codeResult

  // 搴旂敤瑙嗛閰嶇疆
  const frameRate = videoConfig?.frameRate || 30

  logger.info('Rendering video', { jobId, quality, usedAI, frameRate })

  // 鍒涘缓涓存椂鐩綍
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

    // 娓叉煋鍑芥暟 - 渚涢噸璇曟満鍒朵娇鐢?
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

      logger.info('Starting render', {
        jobId,
        codeLength: cleaned.code.length
      })

      // 鍐欏叆浠ｇ爜鏂囦欢
      fs.writeFileSync(codeFile, cleaned.code, 'utf-8')
      logger.info('Code written to file', { jobId, codeFile })

      // 鎵ц manim
      const options: ManimExecuteOptions = {
        jobId,
        quality,
        frameRate,
        tempDir,
        mediaDir
      }

      const result = await executeManimCommand(codeFile, options)
      lastRenderPeakMemoryMB = result.peakMemoryMB

      logger.info('Manim 娓叉煋瀹屾垚', {
        jobId,
        success: result.success,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
        peakMemoryMB: result.peakMemoryMB
      })

      // 璁板綍瀹屾暣杈撳嚭
      if (result.stdout) {
        logger.info('Manim stdout 杈撳嚭', { jobId, stdout: result.stdout })
      }

      if (result.stderr) {
        if (result.success) {
          logger.info('Manim stderr output (non-error)', { jobId, stderr: result.stderr })
        } else {
          logger.error('Manim stderr 杈撳嚭锛堥敊璇級', { jobId, stderr: result.stderr })
        }
      }

      return result
    }

    // 鍐冲畾浣跨敤鍝娓叉煋绛栫暐
    let finalCode = manimCode
    let renderResult: { success: boolean; stderr: string; stdout: string; peakMemoryMB: number }

    // 妫€鏌ユ槸鍚︽湁鍦烘櫙璁捐鏂规锛堟潵鑷袱闃舵 AI 鐢熸垚锛?
    const hasSceneDesign = usedAI && !!sceneDesign

    if (hasSceneDesign) {
      // 浣跨敤鏂扮殑閲嶈瘯鏈哄埗锛氱淮鎶ゅ畬鏁村璇濆巻鍙?
      logger.info('Using new code retry mechanism', { jobId, hasSceneDesign })

      await storeJobStage(jobId, 'generating')

      const retryStart = Date.now()

      // 鍒涘缓閲嶈瘯涓婁笅鏂?
      const retryContext = createRetryContext(concept, sceneDesign, promptOverrides)

      // 鎵ц閲嶈瘯绠＄悊鍣?
      const retryManagerResult = await executeCodeRetry(
        retryContext,
        renderCode,
        customApiConfig
      )

      timings.retry = Date.now() - retryStart

      if (retryManagerResult.success) {
        finalCode = retryManagerResult.code
        renderResult = {
          success: true,
          stderr: '',
          stdout: '',
          peakMemoryMB: lastRenderPeakMemoryMB
        }

        logger.info('浠ｇ爜閲嶈瘯鎴愬姛', {
          jobId,
          attempts: retryManagerResult.attempts
        })
      } else {
        // 鎵€鏈夐噸璇曞潎澶辫触
        throw new Error(
          `Code retry failed after ${retryManagerResult.attempts} attempts: ${retryManagerResult.lastError}`
        )
      }
    } else {
      // 闈濧I鐢熸垚鎴栨棤鍦烘櫙璁捐鏂规锛氬崟娆℃覆鏌?
      logger.info('Using single render attempt', {
        jobId,
        reason: usedAI ? 'no_scene_design' : 'not_ai_generated'
      })

      if (onStageUpdate) await onStageUpdate()
      renderResult = await renderCode(manimCode)

      if (!renderResult.success) {
        logger.error('Manim 娓叉煋澶辫触', {
          jobId,
          stderrLength: renderResult.stderr.length,
          stdoutLength: renderResult.stdout.length,
          stderr: renderResult.stderr,
          stdout: renderResult.stdout
        })
        throw new Error(renderResult.stderr || 'Manim render failed')
      }

      finalCode = lastRenderedCode
    }

    // 鏌ユ壘鐢熸垚鐨勮棰戞枃浠?
    const videoPath = findVideoFile(mediaDir, quality, frameRate)
    if (!videoPath) {
      throw new Error('Video file not found after render')
    }

    // 澶嶅埗鍒拌緭鍑虹洰褰?
    const outputFilename = `${jobId}.mp4`
    const outputPath = path.join(outputDir, outputFilename)
    fs.copyFileSync(videoPath, outputPath)

    logger.info('Video saved', { jobId, outputPath })

    return {
      jobId,
      concept,
      manimCode: finalCode,
      usedAI,
      generationType,
      quality,
      videoUrl: `/videos/${outputFilename}`,
      renderPeakMemoryMB: renderResult.peakMemoryMB
    }
  } finally {
    // 娓呯悊涓存椂鐩綍
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
      logger.info('Cleaned up temp dir', { jobId })
    } catch (error) {
      logger.warn('Cleanup failed', { jobId, error })
    }
  }
}

/**
 * 澶勭悊棰勭敓鎴愪唬鐮?
 */
export async function handlePreGeneratedCode(
  jobId: string,
  concept: string,
  quality: string,
  preGeneratedCode: string,
  timings: Record<string, number>,
  jobData: VideoJobData
): Promise<RenderResult> {
  logger.info('Using pre-generated code from frontend', {
    jobId,
    codeLength: preGeneratedCode.length,
    hasCustomApi: !!jobData.customApiConfig
  })

  // 鐩存帴杩涘叆娓叉煋闃舵
  const renderStart = Date.now()
  const renderResult = await renderVideo(jobId, concept, quality, {
    manimCode: preGeneratedCode,
    usedAI: false,
    generationType: 'custom-api'
  }, timings, jobData.customApiConfig, jobData.videoConfig, jobData.promptOverrides)
  timings.render = Date.now() - renderStart

  logger.info('Job completed (pre-generated code)', { jobId, timings })
  return renderResult
}
