import fs from 'fs'
import os from 'os'
import path from 'path'
import { createLogger } from '../../../utils/logger'
import { cleanManimCode } from '../../../utils/manim-code-cleaner'
import { executeManimCommand, type ManimExecuteOptions } from '../../../utils/manim-executor'
import { findImageFile } from '../../../utils/file-utils'
import { createRetryContext, executeCodeRetry } from '../../../services/code-retry/manager'
import { ensureJobNotCancelled } from '../../../services/job-cancel'
import type { GenerationResult } from './analysis-step'
import type { PromptOverrides, VideoConfig } from '../../../types'
import type { RenderResult } from './render-step-types'

const logger = createLogger('RenderImageStep')

interface ImageCodeBlock {
  index: number
  code: string
}

interface ImageRenderAttempt {
  success: boolean
  stderr: string
  stdout: string
  peakMemoryMB: number
  imageUrls: string[]
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

  const remaining = code
    .replace(/###\s*YON_IMAGE_(\d+)_START\s*###[\s\S]*?###\s*YON_IMAGE_\1_END\s*###/g, '')
    .trim()
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

function clearPreviousImages(outputDir: string, jobId: string): void {
  const prefix = `${jobId}-`
  if (!fs.existsSync(outputDir)) {
    return
  }

  for (const entry of fs.readdirSync(outputDir)) {
    if (entry.startsWith(prefix) && entry.endsWith('.png')) {
      fs.rmSync(path.join(outputDir, entry), { force: true })
    }
  }
}

async function renderImageBlocks(
  jobId: string,
  quality: string,
  code: string,
  frameRate: number,
  timeoutMs: number,
  tempDir: string,
  outputDir: string
): Promise<ImageRenderAttempt> {
  try {
    await ensureJobNotCancelled(jobId)

    logger.info('Image parse stage started', { jobId, stage: 'image-parse' })
    const blocks = parseImageCodeBlocks(code)
    logger.info('Image parse stage completed', { jobId, stage: 'image-parse', blockCount: blocks.length })

    clearPreviousImages(outputDir, jobId)

    const imageUrls: string[] = []
    let peakMemoryMB = 0
    const attemptSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

    for (const block of blocks) {
      await ensureJobNotCancelled(jobId)

      const stageName = `image-render-${block.index}`
      logger.info('Image render stage started', { jobId, stage: stageName, blockIndex: block.index })

      const blockDir = path.join(tempDir, `attempt-${attemptSuffix}`, `image-${block.index}`)
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
        return {
          success: false,
          stderr: `图片 ${block.index} 渲染失败: ${renderResult.stderr || 'Manim render failed'}`,
          stdout: renderResult.stdout || '',
          peakMemoryMB,
          imageUrls: []
        }
      }

      const imagePath = findImageFile(mediaDir, sceneName)
      if (!imagePath) {
        return {
          success: false,
          stderr: `图片 ${block.index} 渲染完成但未找到 PNG 输出`,
          stdout: '',
          peakMemoryMB,
          imageUrls: []
        }
      }

      const outputFilename = `${jobId}-${block.index}.png`
      const outputPath = path.join(outputDir, outputFilename)
      fs.copyFileSync(imagePath, outputPath)
      imageUrls.push(`/images/${outputFilename}`)

      logger.info('Image render stage completed', { jobId, stage: stageName, outputFilename })
    }

    return {
      success: true,
      stderr: '',
      stdout: '',
      peakMemoryMB,
      imageUrls
    }
  } catch (error) {
    return {
      success: false,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: '',
      peakMemoryMB: 0,
      imageUrls: []
    }
  }
}

export async function renderImages(
  jobId: string,
  concept: string,
  quality: string,
  codeResult: GenerationResult,
  timings?: Record<string, number>,
  videoConfig?: VideoConfig,
  customApiConfig?: unknown,
  promptOverrides?: PromptOverrides,
  onStageUpdate?: () => Promise<void>
): Promise<RenderResult> {
  const { manimCode, usedAI, generationType, sceneDesign } = codeResult
  const frameRate = videoConfig?.frameRate || 15
  const timeoutMs = (videoConfig?.timeout && videoConfig.timeout > 0 ? videoConfig.timeout : 600) * 1000

  const tempDir = path.join(os.tmpdir(), `manim-${jobId}`)
  const outputDir = path.join(process.cwd(), 'public', 'images')

  try {
    fs.mkdirSync(tempDir, { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })
    await ensureJobNotCancelled(jobId)

    if (onStageUpdate) {
      await onStageUpdate()
    }

    let finalCode = manimCode
    let finalImageUrls: string[] = []
    let peakMemoryMB = 0

    const renderWithCode = async (candidateCode: string): Promise<{ success: boolean; stderr: string; stdout: string; peakMemoryMB: number }> => {
      const attempt = await renderImageBlocks(jobId, quality, candidateCode, frameRate, timeoutMs, tempDir, outputDir)
      peakMemoryMB = Math.max(peakMemoryMB, attempt.peakMemoryMB)
      if (attempt.success) {
        finalImageUrls = attempt.imageUrls
      }
      return {
        success: attempt.success,
        stderr: attempt.stderr,
        stdout: attempt.stdout,
        peakMemoryMB: attempt.peakMemoryMB
      }
    }

    if (usedAI) {
      const retryContext = createRetryContext(
        concept,
        sceneDesign?.trim() || `概念：${concept}`,
        promptOverrides,
        'image'
      )

      const retryManagerResult = await executeCodeRetry(retryContext, renderWithCode, customApiConfig, manimCode)
      if (typeof retryManagerResult.generationTimeMs === 'number' && timings) {
        timings.retry = retryManagerResult.generationTimeMs
      }
      if (!retryManagerResult.success) {
        throw new Error(
          `Code retry failed after ${retryManagerResult.attempts} attempts: ${retryManagerResult.lastError}`
        )
      }

      finalCode = retryManagerResult.code
    } else {
      const singleAttempt = await renderImageBlocks(jobId, quality, manimCode, frameRate, timeoutMs, tempDir, outputDir)
      peakMemoryMB = Math.max(peakMemoryMB, singleAttempt.peakMemoryMB)
      if (!singleAttempt.success) {
        throw new Error(singleAttempt.stderr || 'Manim image render failed')
      }
      finalImageUrls = singleAttempt.imageUrls
    }

    await ensureJobNotCancelled(jobId)

    return {
      jobId,
      concept,
      outputMode: 'image',
      manimCode: finalCode,
      usedAI,
      generationType,
      quality,
      imageUrls: finalImageUrls,
      imageCount: finalImageUrls.length,
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
