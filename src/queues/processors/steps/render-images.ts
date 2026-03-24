import fs from 'fs'
import path from 'path'
import { createLogger } from '../../../utils/logger'
import { cleanManimCode } from '../../../utils/manim-code-cleaner'
import { executeManimCommand, type ManimExecuteOptions } from '../../../utils/manim-executor'
import { findImageFile } from '../../../utils/file-utils'
import { ensureJobNotCancelled } from '../../../services/job-cancel'
import { JobCancelledError } from '../../../utils/errors'
import { resolveJobTimeoutMs } from '../../../utils/job-timeout'
import { resolveRenderCacheWorkspace } from '../../../utils/render-cache-workspace'
import {
  createRenderFailureEvent,
  extractCodeSnippet,
  inferErrorMessage,
  inferErrorType,
  isRenderFailureFeatureEnabled,
  sanitizeFullCode,
  sanitizeStderrPreview,
  sanitizeStdoutPreview
} from '../../../render-failure'
import type { GenerationResult } from './analysis-step'
import type { CustomApiConfig, PromptOverrides, VideoConfig } from '../../../types'
import type { RenderResult } from './render-step-types'
import { executeRenderWithRetry } from './render-with-retry'

const logger = createLogger('RenderImageStep')

function writeImagesIntoWorkspace(workspaceDirectory: string | undefined, jobId: string, sourceImagePaths: string[]): string[] | undefined {
  if (!workspaceDirectory || sourceImagePaths.length === 0) {
    return undefined
  }

  const workspaceOutputDir = path.join(workspaceDirectory, 'renders', jobId)
  fs.mkdirSync(workspaceOutputDir, { recursive: true })

  return sourceImagePaths.map((sourcePath, index) => {
    const suffix = path.extname(sourcePath) || '.png'
    const workspaceImagePath = path.join(workspaceOutputDir, `image-${String(index + 1).padStart(3, '0')}${suffix}`)
    fs.copyFileSync(sourcePath, workspaceImagePath)
    return workspaceImagePath
  })
}

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
  outputPaths: string[]
  exitCode?: number
  failedCode?: string
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
    throw new Error('No YON_IMAGE code blocks were found')
  }

  const remaining = code
    .replace(/###\s*YON_IMAGE_(\d+)_START\s*###[\s\S]*?###\s*YON_IMAGE_\1_END\s*###/g, '')
    .trim()
  if (remaining.length > 0) {
    throw new Error('Image mode only accepts code inside YON_IMAGE blocks')
  }

  blocks.sort((a, b) => a.index - b.index)
  return blocks
}

function detectSceneName(code: string): string {
  const match = code.match(/class\s+([A-Za-z_]\w*)\s*\([^)]*Scene[^)]*\)\s*:/)
  if (match?.[1]) {
    return match[1]
  }
  throw new Error('Image code block is missing a renderable Scene class')
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

function resolveModel(customApiConfig?: unknown): string | undefined {
  const model = (customApiConfig as Partial<CustomApiConfig> | undefined)?.model
  const normalized = typeof model === 'string' ? model.trim() : ''
  return normalized || undefined
}

async function renderImageBlocks(
  jobId: string,
  quality: string,
  code: string,
  frameRate: number,
  timeoutMs: number,
  renderCacheKey: string,
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

    for (const block of blocks) {
      await ensureJobNotCancelled(jobId)

      const stageName = `image-render-${block.index}`
      logger.info('Image render stage started', { jobId, stage: stageName, blockIndex: block.index })

      const blockWorkspace = resolveRenderCacheWorkspace(renderCacheKey, 'image', block.index)
      const blockDir = blockWorkspace.tempDir
      const mediaDir = blockWorkspace.mediaDir
      const codeFile = blockWorkspace.codeFile

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
          stderr: `Image ${block.index} render failed: ${renderResult.stderr || 'Manim render failed'}`,
          stdout: renderResult.stdout || '',
          peakMemoryMB,
          imageUrls: [],
          outputPaths: [],
          exitCode: renderResult.exitCode,
          failedCode: cleaned.code
        }
      }

      const imagePath = findImageFile(mediaDir, sceneName)
      if (!imagePath) {
        return {
          success: false,
          stderr: `Image ${block.index} render completed but no PNG output was found`,
          stdout: '',
          peakMemoryMB,
          imageUrls: [],
          outputPaths: [],
          failedCode: cleaned.code
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
      imageUrls,
      outputPaths: blocks.map((block) => path.join(outputDir, `${jobId}-${block.index}.png`))
    }
  } catch (error) {
    if (error instanceof JobCancelledError) {
      throw error
    }

    return {
      success: false,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: '',
      peakMemoryMB: 0,
      imageUrls: [],
      outputPaths: []
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
  onStageUpdate?: () => Promise<void>,
  clientId?: string,
  workspaceDirectory?: string,
  renderCacheKey?: string
): Promise<RenderResult> {
  const { code, usedAI, generationType, sceneDesign } = codeResult
  const frameRate = videoConfig?.frameRate || 15
  const timeoutMs = resolveJobTimeoutMs(videoConfig)

  const stableRenderCacheKey = renderCacheKey || workspaceDirectory || `job-${jobId}`
  const outputDir = path.join(process.cwd(), 'public', 'images')

  const logRenderFailure = async (args: {
    attempt: number
    code: string
    codeSnippet?: string
    stderr: string
    stdout: string
    peakMemoryMB: number
    exitCode?: number
    promptRole: string
  }): Promise<void> => {
    if (!isRenderFailureFeatureEnabled()) {
      return
    }

    try {
      await createRenderFailureEvent({
        job_id: jobId,
        attempt: args.attempt,
        output_mode: 'image',
        error_type: inferErrorType(args.stderr),
        error_message: inferErrorMessage(args.stderr),
        stderr_preview: sanitizeStderrPreview(args.stderr),
        stdout_preview: sanitizeStdoutPreview(args.stdout),
        code_snippet: extractCodeSnippet(args.codeSnippet || args.code),
        full_code: sanitizeFullCode(args.code),
        peak_memory_mb: args.peakMemoryMB,
        exit_code: args.exitCode,
        recovered: false,
        model: resolveModel(customApiConfig),
        prompt_version: process.env.PROMPT_VERSION?.trim() || null,
        prompt_role: args.promptRole,
        client_id: clientId || null,
        concept: concept || null
      })
    } catch (error) {
      console.error('[RenderImageStep] Failed to record render failure:', error)
    }
  }

  fs.mkdirSync(outputDir, { recursive: true })
  await ensureJobNotCancelled(jobId)

  if (onStageUpdate) {
    await onStageUpdate()
  }

  let finalImageUrls: string[] = []
  let finalImageOutputPaths: string[] = []
  let peakMemoryMB = 0

  const renderWithCode = async (candidateCode: string): Promise<{
    success: boolean
    stderr: string
    stdout: string
    peakMemoryMB: number
    exitCode?: number
    codeSnippet?: string
  }> => {
    const attempt = await renderImageBlocks(jobId, quality, candidateCode, frameRate, timeoutMs, stableRenderCacheKey, outputDir)
    peakMemoryMB = Math.max(peakMemoryMB, attempt.peakMemoryMB)
    if (attempt.success) {
      finalImageUrls = attempt.imageUrls
      finalImageOutputPaths = attempt.outputPaths
    }
    return {
      success: attempt.success,
      stderr: attempt.stderr,
      stdout: attempt.stdout,
      peakMemoryMB: attempt.peakMemoryMB,
      exitCode: attempt.exitCode,
      codeSnippet: attempt.failedCode
    }
  }

  const { finalCode } = await executeRenderWithRetry({
    concept,
    outputMode: 'image',
    sceneDesign,
    promptOverrides,
    customApiConfig,
    initialCode: code,
    usedAI,
    timings,
    renderCode: renderWithCode,
    logRenderFailure,
    ensureJobNotCancelled: async () => ensureJobNotCancelled(jobId)
  })

  await ensureJobNotCancelled(jobId)

  const workspaceImagePaths = writeImagesIntoWorkspace(workspaceDirectory, jobId, finalImageOutputPaths)

  return {
    jobId,
    concept,
    outputMode: 'image',
    code: finalCode,
    codeLanguage: 'manim-python',
    usedAI,
    generationType,
    quality,
    imageUrls: finalImageUrls,
    imageCount: finalImageUrls.length,
    workspaceImagePaths,
    renderPeakMemoryMB: peakMemoryMB || undefined
  }
}
