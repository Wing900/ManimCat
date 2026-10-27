import fs from 'fs'
import path from 'path'
import { createLogger } from '../../../../shared/logging/logger'
import { cleanManimCode } from '../../../../utils/manim-code-cleaner'
import { executeManimCommand, type ManimExecuteOptions } from '../../../../utils/manim-executor'
import { addBackgroundMusic } from '../../../manim/bgm-mixer'
import {
  cleanupNarrationWorkspace,
  muxNarrationIntoVideo,
  resolveNarrationWorkspace
} from '../../../manim/narration-mixer'
import { ensureJobNotCancelled } from '../../../job/job-cancel'
import { isJobCancelled } from '../../../job/job-cancel-store'
import { storeJobStage } from '../../../../infrastructure/redis/job/redis-job-state-store'
import { resolveJobTimeoutMs } from '../../../../utils/job-timeout'
import { resolveRenderCacheWorkspace } from '../../../../utils/render-cache-workspace'
import { workspaceRenderOutputDirectory } from '../../../workspace-output-directory'
import {
  createRenderFailureEvent,
  extractCodeSnippet,
  inferErrorMessage,
  inferErrorType,
  isRenderFailureFeatureEnabled,
  sanitizeFullCode,
  sanitizeStderrPreview,
  sanitizeStdoutPreview
} from '../../../../operations/render-failures'
import type { GenerationResult } from './analysis-step'
import type { CustomApiConfig, PromptOverrides, VideoConfig } from '../../../../types'
import type { RenderResult } from './render-step-types'
import { executeRenderWithRetry } from './render-with-retry'
import { extractCodeContext } from '../../../../workflow/code-retry/utils'

const logger = createLogger('RenderVideoStep')

function logNarrationSyncReport(jobId: string, syncReportPath: string | undefined): void {
  if (!syncReportPath) {
    return
  }
  try {
    const report = JSON.parse(fs.readFileSync(syncReportPath, 'utf-8')) as unknown
    logger.info('Narration sync report', { jobId, syncReportPath, report })
  } catch (error) {
    logger.warn('Narration sync report was not written', { jobId, syncReportPath, error: String(error) })
  }
}

function writeVideoIntoWorkspace(workspaceDirectory: string | undefined, jobId: string, sourceVideoPath: string, versionDirectory?: string): string | undefined {
  if (!workspaceDirectory) {
    return undefined
  }

  const workspaceOutputDir = workspaceRenderOutputDirectory(workspaceDirectory, jobId, versionDirectory)
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
  renderCacheKey?: string,
  workspaceOutputDirectory?: string,
  sceneName?: string
): Promise<RenderResult> {
  const { code, usedAI, generationType, sceneDesign } = codeResult

  const frameRate = videoConfig?.frameRate || 60
  const timeoutMs = resolveJobTimeoutMs(videoConfig)

  logger.info('Rendering video', { jobId, quality, usedAI, frameRate, timeoutMs })

  const stableRenderCacheKey = renderCacheKey || workspaceDirectory || `job-${jobId}`
  const cacheWorkspace = resolveRenderCacheWorkspace(stableRenderCacheKey, 'video', jobId)
  const tempDir = cacheWorkspace.tempDir
  const mediaDir = cacheWorkspace.mediaDir
  const codeFile = cacheWorkspace.codeFile
  const outputDir = path.join(process.cwd(), 'public', 'videos')
  const narrationWorkspace = codeResult.narration
    ? resolveNarrationWorkspace(stableRenderCacheKey, jobId)
    : undefined
  const narrationSyncReportPath = narrationWorkspace?.syncReportPath

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
  let renderedVideoPath: string | undefined

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
      sceneName,
      isCancelled: () => isJobCancelled(jobId),
      tempDir,
      mediaDir,
      timeoutMs,
      narrationManifestPath: codeResult.narration?.manifestPath,
      narrationSyncReportPath
    }

    const renderStart = Date.now()
    const result = await executeManimCommand(codeFile, options)
    timings.render = (timings.render || 0) + (Date.now() - renderStart)
    renderedVideoPath = result.success ? result.outputPath : undefined
    lastRenderPeakMemoryMB = result.peakMemoryMB
    return {
      ...result,
      codeSnippet: result.success ? undefined : extractCodeContext(cleaned.code, result.stderr)
    }
  }

  if (usedAI) {
    logger.info('Using local code-retry for video render', { jobId, hasSceneDesign: !!sceneDesign })
  } else {
    logger.info('Using single render attempt for video', {
      jobId,
      reason: 'not_ai_generated'
    })
  }

  if (onStageUpdate) await onStageUpdate()

  const retryResult = await executeRenderWithRetry({
    problemPlan: codeResult.problemPlan,
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
    ensureJobNotCancelled: async () => ensureJobNotCancelled(jobId),
    onRetryStart: async () => {
      await storeJobStage(jobId, 'retrying', { status: 'processing' })
    }
  }).catch((error: unknown) => {
    // A cancelled or failed render must not leave this run's narration sidecar behind.
    cleanupNarrationWorkspace(narrationWorkspace?.outputDirectory)
    throw error
  })
  const finalCode = usedAI ? retryResult.finalCode : lastRenderedCode

  await ensureJobNotCancelled(jobId)
  const videoPath = renderedVideoPath
  if (!videoPath) {
    throw new Error('Video file not found after render')
  }

  if (codeResult.narration) {
    await storeJobStage(jobId, 'muxing', { status: 'processing' })
    const muxStart = Date.now()
    await muxNarrationIntoVideo({
      videoPath,
      narration: codeResult.narration,
      bgm: videoConfig?.bgm === true
    })
    timings.mux = (timings.mux || 0) + (Date.now() - muxStart)
    logNarrationSyncReport(jobId, narrationSyncReportPath)
  }

  const outputFilename = `${jobId}.mp4`
  const outputPath = path.join(outputDir, outputFilename)
  fs.copyFileSync(videoPath, outputPath)

  // Narration mux already folded BGM under the voice; only the silent path uses the legacy mixer.
  if (videoConfig?.bgm === true && !codeResult.narration) {
    await addBackgroundMusic(outputPath)
  }

  const workspaceVideoPath = writeVideoIntoWorkspace(workspaceDirectory, jobId, outputPath, workspaceOutputDirectory)

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
