import fs from 'fs'
import os from 'os'
import path from 'path'
import { createLogger } from '../../../utils/logger'
import { cleanManimCode } from '../../../utils/manim-code-cleaner'
import { executeManimCommand, type ManimExecuteOptions } from '../../../utils/manim-executor'
import { findImageFile } from '../../../utils/file-utils'
import type { GenerationResult } from './analysis-step'
import type { VideoConfig } from '../../../types'
import type { RenderResult } from './render-step-types'

const logger = createLogger('RenderImageStep')

interface ImageCodeBlock {
  index: number
  code: string
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

export async function renderImages(
  jobId: string,
  concept: string,
  quality: string,
  codeResult: GenerationResult,
  _timings?: Record<string, number>,
  videoConfig?: VideoConfig,
  onStageUpdate?: () => Promise<void>
): Promise<RenderResult> {
  const { manimCode, usedAI, generationType } = codeResult
  const frameRate = videoConfig?.frameRate || 15
  const timeoutMs = (videoConfig?.timeout && videoConfig.timeout > 0 ? videoConfig.timeout : 600) * 1000

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
