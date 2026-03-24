import fs from 'fs'
import path from 'path'
import { createLogger } from '../../../utils/logger'
import { cleanManimCode } from '../../../utils/manim-code-cleaner'
import { executeManimCommand, type ManimExecuteOptions } from '../../../utils/manim-executor'
import { findVideoFile } from '../../../utils/file-utils'
import { addBackgroundMusic } from '../../../audio/bgm-mixer'
import { ensureJobNotCancelled } from '../../../services/job-cancel'
import { storeJobStage } from '../../../services/job-store'
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

const logger = createLogger('RenderVideoStep')

function writeVideoIntoWorkspace(workspaceDirectory: string | undefined, jobId: string, sourceVideoPath: string): string | undefined {
  if (!workspaceDirectory) {
    return undefined
  }

  const workspaceOutputDir = path.join(workspaceDirectory, 'renders', jobId)
  fs.mkdirSync(workspaceOutputDir, { recursive: true })
  const workspaceVideoPath = path.join(workspaceOutputDir, 'output.mp4')
  fs.copyFileSync(sourceVideoPath, workspaceVideoPath)
  return workspaceVideoPath
}

function resolveModel(customApiConfig?: unknown): string | undefined {
  const model = (customApiConfig as Partial<CustomApiConfig> | undefined)?.model
  const normalized = typeof model === 'string' ? model.trim() : ''
  return normalized || undefined
}

export async function renderVideo(
  jobId: string,
  concept: string,
  quality: string,
  codeResult: GenerationResult,
  timings: Record<string, number>,
  customApiConfig?: unknown,
  videoConfig?: VideoConfig,
  promptOverrides?: PromptOverrides,
  onStageUpdate?: () => Promise<void>,
  clientId?: string,
  workspaceDirectory?: string,
  renderCacheKey?: string
): Promise<RenderResult> {
  const { code, usedAI, generationType, sceneDesign } = codeResult

  const frameRate = videoConfig?.frameRate || 15
  const timeoutMs = resolveJobTimeoutMs(videoConfig)

  logger.info('Rendering video', { jobId, quality, usedAI, frameRate, timeoutMs })

  const stableRenderCacheKey = renderCacheKey || workspaceDirectory || `job-${jobId}`
  const cacheWorkspace = resolveRenderCacheWorkspace(stableRenderCacheKey, 'video')
  const tempDir = cacheWorkspace.tempDir
  const mediaDir = cacheWorkspace.mediaDir
  const codeFile = cacheWorkspace.codeFile
  const outputDir = path.join(process.cwd(), 'public', 'videos')

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
        output_mode: 'video',
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
      console.error('[RenderVideoStep] Failed to record render failure:', error)
    }
  }

  fs.mkdirSync(tempDir, { recursive: true })
  fs.mkdirSync(mediaDir, { recursive: true })
  fs.mkdirSync(outputDir, { recursive: true })

  let lastRenderedCode = code
  let lastRenderPeakMemoryMB = 0

  const renderCode = async (candidateCode: string): Promise<{
    success: boolean
    stderr: string
    stdout: string
    peakMemoryMB: number
    exitCode?: number
    codeSnippet?: string
  }> => {
    await ensureJobNotCancelled(jobId)
    const cleaned = cleanManimCode(candidateCode)
    lastRenderedCode = cleaned.code

    if (cleaned.changes.length > 0) {
      logger.info('Manim code cleaned', {
        jobId,
        changes: cleaned.changes,
        originalLength: candidateCode.length,
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
    return {
      ...result,
      codeSnippet: cleaned.code
    }
  }

  if (usedAI) {
    logger.info('Using local code-retry for video render', { jobId, hasSceneDesign: !!sceneDesign })
    await storeJobStage(jobId, 'generating')
  } else {
    logger.info('Using single render attempt for video', {
      jobId,
      reason: 'not_ai_generated'
    })
  }

  if (onStageUpdate) await onStageUpdate()

  const retryResult = await executeRenderWithRetry({
    concept,
    outputMode: 'video',
    sceneDesign,
    promptOverrides,
    customApiConfig,
    initialCode: code,
    usedAI,
    timings,
    renderCode,
    logRenderFailure,
    ensureJobNotCancelled: async () => ensureJobNotCancelled(jobId)
  })
  const finalCode = usedAI ? retryResult.finalCode : lastRenderedCode

  await ensureJobNotCancelled(jobId)
  const videoPath = findVideoFile(mediaDir, quality, frameRate)
  if (!videoPath) {
    throw new Error('Video file not found after render')
  }

  const outputFilename = `${jobId}.mp4`
  const outputPath = path.join(outputDir, outputFilename)
  fs.copyFileSync(videoPath, outputPath)

  if (videoConfig?.bgm !== false) {
    await addBackgroundMusic(outputPath)
  }

  const workspaceVideoPath = writeVideoIntoWorkspace(workspaceDirectory, jobId, outputPath)

  return {
    jobId,
    concept,
    outputMode: 'video',
    code: finalCode,
    codeLanguage: 'manim-python',
    usedAI,
    generationType,
    quality,
    videoUrl: `/videos/${outputFilename}`,
    workspaceVideoPath,
    renderPeakMemoryMB: lastRenderPeakMemoryMB
  }
}
