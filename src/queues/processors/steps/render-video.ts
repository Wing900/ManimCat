import fs from 'fs'
import path from 'path'
import { createLogger } from '../../../utils/logger'
import { cleanManimCode } from '../../../utils/manim-code-cleaner'
import { executeManimCommand, type ManimExecuteOptions } from '../../../utils/manim-executor'
import { findVideoFile } from '../../../utils/file-utils'
import { addBackgroundMusic } from '../../../audio/bgm-mixer'
import { createRetryContext, executeCodeRetry } from '../../../services/code-retry/manager'
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
  const { manimCode, usedAI, generationType, sceneDesign } = codeResult

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

  let lastRenderedCode = manimCode
  let lastRenderPeakMemoryMB = 0

  const renderCode = async (code: string): Promise<{
    success: boolean
    stderr: string
    stdout: string
    peakMemoryMB: number
    exitCode?: number
    codeSnippet?: string
  }> => {
    await ensureJobNotCancelled(jobId)
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
    return {
      ...result,
      codeSnippet: cleaned.code
    }
  }

  let finalCode = manimCode
  let renderResult: {
    success: boolean
    stderr: string
    stdout: string
    peakMemoryMB: number
    exitCode?: number
    codeSnippet?: string
  }

  if (usedAI) {
    logger.info('Using local code-retry for video render', { jobId, hasSceneDesign: !!sceneDesign })
    await storeJobStage(jobId, 'generating')
    if (onStageUpdate) await onStageUpdate()

    const retryContext = createRetryContext(
      concept,
      sceneDesign?.trim() || `概念: ${concept}`,
      promptOverrides,
      'video'
    )
    const retryManagerResult = await executeCodeRetry(
      retryContext,
      renderCode,
      customApiConfig,
      manimCode,
      async (event) => {
        await logRenderFailure({ ...event, promptRole: 'codeRetry' })
      },
      async () => ensureJobNotCancelled(jobId)
    )

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
      reason: 'not_ai_generated'
    })
    if (onStageUpdate) await onStageUpdate()
    renderResult = await renderCode(manimCode)
    if (!renderResult.success) {
      await logRenderFailure({
        attempt: 1,
        code: manimCode,
        codeSnippet: renderResult.codeSnippet,
        stderr: renderResult.stderr,
        stdout: renderResult.stdout,
        peakMemoryMB: renderResult.peakMemoryMB,
        exitCode: renderResult.exitCode,
        promptRole: 'single-render'
      })
      throw new Error(renderResult.stderr || 'Manim render failed')
    }
    finalCode = lastRenderedCode
  }

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
    manimCode: finalCode,
    usedAI,
    generationType,
    quality,
    videoUrl: `/videos/${outputFilename}`,
    workspaceVideoPath,
    renderPeakMemoryMB: renderResult.peakMemoryMB
  }
}
