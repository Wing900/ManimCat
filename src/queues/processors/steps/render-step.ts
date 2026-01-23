/**
 * 视频渲染步骤
 * 执行 Manim 渲染，AI 代码完善
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { executeManimCommand, ManimExecuteOptions } from '../../../utils/manim-executor'
import { findVideoFile } from '../../../utils/file-utils'
import { executeRetryLogic, isCodeFixEnabled } from '../../../services/ai-code-fix'
import { storeJobStage } from '../../../services/job-store'
import { createLogger } from '../../../utils/logger'
import type { VideoJobData, VideoConfig } from '../../../types'

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
}

/**
 * 代码生成结果类型
 */
export interface GenerationResult {
  manimCode: string
  usedAI: boolean
  generationType: string
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
  onStageUpdate?: () => Promise<void>
): Promise<RenderResult> {
  const { manimCode, usedAI, generationType } = codeResult

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

    // 渲染函数 - 供完善逻辑使用
    const renderCode = async (code: string): Promise<{ success: boolean; stderr: string; stdout: string }> => {
      logger.info('开始渲染代码', {
        jobId,
        codeLength: code.length,
        code
      })

      // 写入代码文件
      fs.writeFileSync(codeFile, code, 'utf-8')
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
      const renderDuration = Date.now() // 简化计时

      logger.info('Manim 渲染完成', {
        jobId,
        success: result.success,
        duration: renderDuration,
        durationSeconds: (renderDuration / 1000).toFixed(2),
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length
      })

      // 记录完整的输出（成功或失败都记录）
      if (result.stdout) {
        logger.info('Manim stdout 输出', {
          jobId,
          stdout: result.stdout
        })
      }

      if (result.stderr) {
        if (result.success) {
          logger.info('Manim stderr 输出（非错误）', {
            jobId,
            stderr: result.stderr
          })
        } else {
          logger.error('Manim stderr 输出（错误）', {
            jobId,
            stderr: result.stderr
          })
        }
      }

      return result
    }

    // 决定是否使用重试逻辑（仅对 AI 生成的代码）
    let finalCode = manimCode
    let renderResult: { success: boolean; stderr: string; stdout: string }

    if (usedAI && isCodeFixEnabled()) {
      logger.info('Using AI retry logic', { jobId })

      // 更新阶段为"完善中"
      const updateStageToRefining = async () => {
        await storeJobStage(jobId, 'refining')
        logger.info('Stage updated to refining', { jobId })
      }

      // 更新阶段为"渲染中"
      const updateStageToRendering = async () => {
        await storeJobStage(jobId, 'rendering')
        logger.info('Stage updated to rendering', { jobId })
      }

      // AI 完善详细计时
      const retryStart = Date.now()

      const retryResult = await executeRetryLogic(
        manimCode,
        concept,
        renderCode,
        updateStageToRefining,
        customApiConfig,
        updateStageToRendering
      )

      timings.retry = Date.now() - retryStart

      finalCode = retryResult.code
      renderResult = {
        success: retryResult.success,
        stderr: retryResult.lastError || '',
        stdout: ''
      }

      if (!retryResult.success) {
        throw new Error(`Code fix failed after ${retryResult.attempts} attempts: ${retryResult.lastError}`)
      }

      logger.info('完善完成', { jobId, attempts: retryResult.attempts })
    } else {
      logger.info('Using single render attempt', { jobId, reason: usedAI ? 'code_fix_disabled' : 'not_ai_generated' })
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
      videoUrl: `/videos/${outputFilename}`
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
    usedAI: false, // 预生成代码不需要 AI 完善修复
    generationType: 'custom-api'
  }, timings, jobData.customApiConfig, jobData.videoConfig)
  timings.render = Date.now() - renderStart

  // 存储结果
  const storeStart = Date.now()
  // 注意：这里需要导入 storage-step，会在后面处理
  timings.store = Date.now() - storeStart

  logger.info('Job completed (pre-generated code)', { jobId, timings })
  return { success: true, source: 'custom-api', timings }
}
