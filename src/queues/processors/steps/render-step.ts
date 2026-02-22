import fs from 'fs'
import os from 'os'
import path from 'path'
import { createLogger } from '../../../utils/logger'
import { cleanManimCode } from '../../../utils/manim-code-cleaner'
import { executeManimCommand, type ManimExecuteOptions } from '../../../utils/manim-executor'
import { findImageFile, findVideoFile } from '../../../utils/file-utils'
import { createRetryContext, executeCodeRetry } from '../../../services/code-retry/manager'
import { storeJobStage } from '../../../services/job-store'
import type { GenerationResult } from './analysis-step'
import type { OutputMode, PromptOverrides, VideoConfig, VideoJobData } from '../../../types'

const logger = createLogger('RenderStep')

interface ImageCodeBlock {
  index: number
  code: string
}

export interface RenderResult {
  jobId: string
  concept: string
  outputMode: OutputMode
  manimCode: string
  usedAI: boolean
  generationType: string
  quality: string
  videoUrl?: string
  imageUrls?: string[]
  imageCount?: number
  renderPeakMemoryMB?: number
}

function parseImageCodeBlocks(code: string): ImageCodeBlock[] {
  const blocks: ImageCodeBlock[] = []
  const blockRegex = /###\s*YON_IMAGE_(\d+)_START\s*###([\s\S]*?)###\s*YON_IMAGE_\1_END\s*###/g
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(code)) !== null) {
    const index = parseInt(match[1], 10)
    const blockCode = match[2].trim()
    if (!Number.isFinite(index) || !blockCode) {
      continue
    }
    blocks.push({ index, code: blockCode })
  }

  if (blocks.length === 0) {
    throw new Error('未检测到任何 YON_IMAGE 锚点代码块')
  }

  const remaining = code.replace(/###\s*YON_IMAGE_(\d+)_START\s*###[\s\S]*?###\s*YON_IMAGE_\1_END\s*###/g, '').trim()
  if (remaining.length > 0) {
    throw new Error('检测到锚点外代码，图片模式仅允许锚点块内容')
  }

  blocks.sort((a, b) => a.index - b.index)
  return blocks
}

function detectSceneName(code: string): string {
  const match = code.match(/class\s+([A-Za-z_]\w*)\s*\([^)]*Scene[^)]*\)\s*:/)
  if (match?.[1]) {
    return match[1]
  }
  throw new Error('图片代码块缺少可渲染的 Scene 类定义')
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

  const frameRate = videoConfig?.frameRate || 15
  const timeoutMs = (videoConfig?.timeout && videoConfig.timeout > 0
    ? videoConfig.timeout
    : 600) * 1000

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

/**
 * 图片模式：按锚点块逐张渲染
 */
export async function renderImages(
  jobId: string,
  concept: string,
  quality: string,
  codeResult: GenerationResult,
  _timings: Record<string, number>,
  videoConfig?: VideoConfig,
  onStageUpdate?: () => Promise<void>
): Promise<RenderResult> {
  const { manimCode, usedAI, generationType } = codeResult
  const frameRate = videoConfig?.frameRate || 15
  const timeoutMs = (videoConfig?.timeout && videoConfig.timeout > 0
    ? videoConfig.timeout
    : 600) * 1000

  logger.info('Image parse stage started', { jobId, stage: 'image-parse' })
  const blocks = parseImageCodeBlocks(manimCode)
  logger.info('Image parse stage completed', { jobId, stage: 'image-parse', blockCount: blocks.length })

  const tempDir = path.join(os.tmpdir(), `manim-${jobId}`)
  const outputDir = path.join(process.cwd(), 'public', 'images')
  const imageUrls: string[] = []
  let peakMemoryMB = 0

  try {
    fs.mkdirSync(tempDir, { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })

    if (onStageUpdate) {
      await onStageUpdate()
    }

    for (const block of blocks) {
      const stageName = `image-render-${block.index}`
      logger.info('Image render stage started', { jobId, stage: stageName, blockIndex: block.index })

      const blockDir = path.join(tempDir, `image-${block.index}`)
      const mediaDir = path.join(blockDir, 'media')
      const codeFile = path.join(blockDir, 'scene.py')

      fs.mkdirSync(mediaDir, { recursive: true })

      const cleaned = cleanManimCode(block.code)
      const sceneName = detectSceneName(cleaned.code)
      fs.writeFileSync(codeFile, cleaned.code, 'utf-8')

      const options: ManimExecuteOptions = {
        jobId,
        quality,
        frameRate,
        format: 'png',
        sceneName,
        tempDir: blockDir,
        mediaDir,
        timeoutMs
      }

      const renderResult = await executeManimCommand(codeFile, options)
      peakMemoryMB = Math.max(peakMemoryMB, renderResult.peakMemoryMB)
      if (!renderResult.success) {
        throw new Error(`图片 ${block.index} 渲染失败: ${renderResult.stderr || 'Manim render failed'}`)
      }

      const imagePath = findImageFile(mediaDir, sceneName)
      if (!imagePath) {
        throw new Error(`图片 ${block.index} 渲染完成但未找到 PNG 输出`)
      }

      const outputFilename = `${jobId}-${block.index}.png`
      const outputPath = path.join(outputDir, outputFilename)
      fs.copyFileSync(imagePath, outputPath)
      imageUrls.push(`/images/${outputFilename}`)

      logger.info('Image render stage completed', { jobId, stage: stageName, outputFilename })
    }

    return {
      jobId,
      concept,
      outputMode: 'image',
      manimCode,
      usedAI,
      generationType,
      quality,
      imageUrls,
      imageCount: imageUrls.length,
      renderPeakMemoryMB: peakMemoryMB || undefined
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
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
  const renderResult = outputMode === 'image'
    ? await renderImages(jobId, concept, quality, codeResult, timings, jobData.videoConfig)
    : await renderVideo(
      jobId,
      concept,
      quality,
      codeResult,
      timings,
      jobData.customApiConfig,
      jobData.videoConfig,
      jobData.promptOverrides
    )
  timings.render = Date.now() - renderStart

  logger.info('Job completed (pre-generated code)', { jobId, outputMode, timings })
  return renderResult
}
