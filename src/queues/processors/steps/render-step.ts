/**
 * 视频渲染步骤
 * 执行 Manim 渲染，使用新的重试机制
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { executeManimCommand, ManimExecuteOptions } from '../../../utils/manim-executor'
import { findVideoFile } from '../../../utils/file-utils'
import { storeJobStage } from '../../../services/job-store'
import { createLogger } from '../../../utils/logger'
import { cleanManimCode } from '../../../utils/manim-code-cleaner'
import { createRetryContext, executeCodeRetry } from '../../../services/code-retry'
import type { PromptOverrides, VideoJobData, VideoConfig } from '../../../types'

const logger = createLogger('RenderStep')

/**
 * 渲染结果类型
 */
export interface RenderResult {
  jobId: string
  concept: string
  manimCode: string
  usedAI: boolean
  generationType: string
  quality: string
  videoUrl: string
  renderPeakMemoryMB: number
}

/**
 * 代码生成结果类型
 */
export interface GenerationResult {
  manimCode: string
  usedAI: boolean
  generationType: string
  sceneDesign?: string // 场景设计方案，用于重试
}

// 质量对应的分辨率配置
const QUALITY_RESOLUTION: Record<string, { width: number; height: number }> = {
  low: { width: 854, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 }
}

/**
 * 任务结果
 */
export interface TaskResult {
  success: boolean
  source: string
  timings: Record<string, number>
}

/**
 * 渲染视频
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

  // 应用视频配置
  const frameRate = videoConfig?.frameRate || 30

  logger.info('Rendering video', { jobId, quality, usedAI, frameRate })

  // 创建临时目录
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

    // 渲染函数 - 供重试机制使用
    const renderCode = async (code: string): Promise<{
      success: boolean
      stderr: string
      stdout: string
      peakMemoryMB: number
    }> => {
      const cleaned = cleanManimCode(code)
      lastRenderedCode = cleaned.code

      if (cleaned.changes.length > 0) {
        logger.info('Manim 代码已清洗', {
          jobId,
          changes: cleaned.changes,
          originalLength: code.length,
          cleanedLength: cleaned.code.length
        })
      }

      logger.info('开始渲染代码', {
        jobId,
        codeLength: cleaned.code.length
      })

      // 写入代码文件
      fs.writeFileSync(codeFile, cleaned.code, 'utf-8')
      logger.info('代码已写入文件', { jobId, codeFile })

      // 执行 manim
      const options: ManimExecuteOptions = {
        jobId,
        quality,
        frameRate,
        tempDir,
        mediaDir
      }

      const result = await executeManimCommand(codeFile, options)
      lastRenderPeakMemoryMB = result.peakMemoryMB

      logger.info('Manim 渲染完成', {
        jobId,
        success: result.success,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
        peakMemoryMB: result.peakMemoryMB
      })

      // 记录完整输出
      if (result.stdout) {
        logger.info('Manim stdout 输出', { jobId, stdout: result.stdout })
      }

      if (result.stderr) {
        if (result.success) {
          logger.info('Manim stderr 输出（非错误）', { jobId, stderr: result.stderr })
        } else {
          logger.error('Manim stderr 输出（错误）', { jobId, stderr: result.stderr })
        }
      }

      return result
    }

    // 决定使用哪种渲染策略
    let finalCode = manimCode
    let renderResult: { success: boolean; stderr: string; stdout: string; peakMemoryMB: number }

    // 检查是否有场景设计方案（来自两阶段 AI 生成）
    const hasSceneDesign = usedAI && !!sceneDesign

    if (hasSceneDesign) {
      // 使用新的重试机制：维护完整对话历史
      logger.info('Using new code retry mechanism', { jobId, hasSceneDesign })

      await storeJobStage(jobId, 'generating')

      const retryStart = Date.now()

      // 创建重试上下文
      const retryContext = createRetryContext(concept, sceneDesign, promptOverrides)

      // 执行重试管理器
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

        logger.info('代码重试成功', {
          jobId,
          attempts: retryManagerResult.attempts
        })
      } else {
        // 所有重试均失败
        throw new Error(
          `Code retry failed after ${retryManagerResult.attempts} attempts: ${retryManagerResult.lastError}`
        )
      }
    } else {
      // 非AI生成或无场景设计方案：单次渲染
      logger.info('Using single render attempt', {
        jobId,
        reason: usedAI ? 'no_scene_design' : 'not_ai_generated'
      })

      if (onStageUpdate) await onStageUpdate()
      renderResult = await renderCode(manimCode)

      if (!renderResult.success) {
        logger.error('Manim 渲染失败', {
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

    // 查找生成的视频文件
    const videoPath = findVideoFile(mediaDir, quality, frameRate)
    if (!videoPath) {
      throw new Error('Video file not found after render')
    }

    // 复制到输出目录
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
    // 清理临时目录
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
      logger.info('Cleaned up temp dir', { jobId })
    } catch (error) {
      logger.warn('Cleanup failed', { jobId, error })
    }
  }
}

/**
 * 处理预生成代码
 */
export async function handlePreGeneratedCode(
  jobId: string,
  concept: string,
  quality: string,
  preGeneratedCode: string,
  timings: Record<string, number>,
  jobData: VideoJobData
): Promise<TaskResult> {
  logger.info('Using pre-generated code from frontend', {
    jobId,
    codeLength: preGeneratedCode.length,
    hasCustomApi: !!jobData.customApiConfig
  })

  // 直接进入渲染阶段
  const renderStart = Date.now()
  const renderResult = await renderVideo(jobId, concept, quality, {
    manimCode: preGeneratedCode,
    usedAI: false,
    generationType: 'custom-api'
  }, timings, jobData.customApiConfig, jobData.videoConfig, jobData.promptOverrides)
  timings.render = Date.now() - renderStart

  // 存储结果
  const storeStart = Date.now()
  timings.store = Date.now() - storeStart

  logger.info('Job completed (pre-generated code)', { jobId, timings })
  return { success: true, source: 'custom-api', timings }
}
