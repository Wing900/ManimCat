import { performance } from 'node:perf_hooks'
import { generateEditedManimCode } from '../../../workflow/code-edit/code-edit'
import { ensureJobNotCancelled } from '../../job/job-cancel'
import { resolveNarrationConfig, resolveNarrationWorkspace } from '../../manim/narration-mixer'
import { resolveReusedNarrationForJob } from '../../manim/narration-reuse'
import { analyzeAndGenerate } from './steps/analysis-step'
import { handlePreGeneratedCode, renderImages, renderVideo } from './steps/render-step'
import { storeResult } from './steps/storage-step'
import { storeProcessingStage } from './video-processor-utils'
import type { StoreJobResultOutcome } from '../../job/job-types'
import type { PromptOverrides, VideoJobData } from '../../../types'

interface FlowResult {
  success: true
  source: 'pre-generated' | 'ai-edit' | 'generation'
  timings: Record<string, number>
  renderPeakMemoryMB?: number
  storeOutcome: StoreJobResultOutcome
}

interface BaseFlowArgs {
  job: any
  data: VideoJobData
  promptOverrides?: PromptOverrides
  timings: Record<string, number>
}

export async function runPreGeneratedFlow(args: BaseFlowArgs): Promise<FlowResult> {
  const { job, data, timings } = args
  const { jobId, concept, quality, outputMode = 'video', preGeneratedCode } = data

  if (!preGeneratedCode) {
    throw new Error('Missing preGeneratedCode')
  }

  await ensureJobNotCancelled(jobId, job)
  const renderResult = await handlePreGeneratedCode(
    jobId,
    concept,
    quality,
    outputMode,
    preGeneratedCode,
    timings,
    data
  )

  const storeStart = performance.now()
  const storeOutcome = await storeResult(renderResult, timings, data.clientId)
  timings.store = performance.now() - storeStart

  return {
    success: true,
    source: 'pre-generated',
    timings,
    renderPeakMemoryMB: renderResult.renderPeakMemoryMB,
    storeOutcome
  }
}

export async function runEditFlow(args: BaseFlowArgs): Promise<FlowResult> {
  const { job, data, promptOverrides, timings } = args
  const { jobId, concept, quality, outputMode = 'video', editCode, editInstructions } = data

  if (!editCode || !editInstructions) {
    throw new Error('Missing edit request')
  }

  await ensureJobNotCancelled(jobId, job)
  await storeProcessingStage(jobId, 'generating')

  const editStart = performance.now()
  const editedCode = await generateEditedManimCode(
    concept,
    editInstructions,
    editCode,
    outputMode,
    data.customApiConfig,
    promptOverrides
  )
  timings.edit = performance.now() - editStart

  if (!editedCode) {
    throw new Error('AI edit returned empty code')
  }

  await ensureJobNotCancelled(jobId, job)
  const reusedNarration = resolveReusedNarrationForJob({
    renderCacheKey: data.renderCacheKey,
    workspaceDirectory: data.workspaceDirectory,
    jobId,
    videoConfig: data.videoConfig,
    outputMode
  })
  const generationResult = {
    code: editedCode,
    usedAI: true,
    generationType: 'ai-edit' as const,
    narration: reusedNarration
  }

  const renderResult =
    outputMode === 'image'
      ? await renderImages(
          jobId,
          concept,
          quality,
          generationResult,
          timings,
          data.videoConfig,
          data.customApiConfig,
          promptOverrides,
          () => storeProcessingStage(jobId, 'rendering'),
          data.clientId,
          data.workspaceDirectory,
          data.renderCacheKey,
          data.workspaceOutputDirectory
        )
      : await renderVideo(
          jobId,
          concept,
          quality,
          generationResult,
          timings,
          data.customApiConfig,
          data.videoConfig,
          promptOverrides,
          () => storeProcessingStage(jobId, 'rendering'),
          data.clientId,
          data.workspaceDirectory,
          data.renderCacheKey,
          data.workspaceOutputDirectory
        )

  const storeStart = performance.now()
  const storeOutcome = await storeResult(renderResult, timings, data.clientId)
  timings.store = performance.now() - storeStart

  return {
    success: true,
    source: 'ai-edit',
    timings,
    renderPeakMemoryMB: renderResult.renderPeakMemoryMB,
    storeOutcome
  }
}

export async function runGenerationFlow(args: BaseFlowArgs): Promise<FlowResult> {
  const { job, data, promptOverrides, timings } = args
  const { jobId, concept, quality, outputMode = 'video', referenceImages } = data

  await ensureJobNotCancelled(jobId, job)

  // Narration is a video-only, opt-in sidecar. Images and disabled configs must not touch TTS.
  const narrationConfig = resolveNarrationConfig(data.videoConfig, outputMode)
  const narrationCacheKey = data.renderCacheKey || data.workspaceDirectory || `job-${jobId}`
  const narration = narrationConfig
    ? {
        config: narrationConfig,
        outputDirectory: resolveNarrationWorkspace(narrationCacheKey, jobId).outputDirectory
      }
    : undefined

  const codeResult = await analyzeAndGenerate(
    jobId,
    concept,
    quality,
    outputMode,
    timings,
    data.customApiConfig,
    promptOverrides,
    referenceImages,
    data.problemPlan,
    narration
  )

  await ensureJobNotCancelled(jobId, job)
  const renderResult =
    outputMode === 'image'
      ? await renderImages(
          jobId,
          concept,
          quality,
          codeResult,
          timings,
          data.videoConfig,
          data.customApiConfig,
          promptOverrides,
          () => storeProcessingStage(jobId, 'rendering'),
          data.clientId,
          data.workspaceDirectory,
          data.renderCacheKey,
          data.workspaceOutputDirectory
        )
      : await renderVideo(
          jobId,
          concept,
          quality,
          codeResult,
          timings,
          data.customApiConfig,
          data.videoConfig,
          promptOverrides,
          () => storeProcessingStage(jobId, 'rendering'),
          data.clientId,
          data.workspaceDirectory,
          data.renderCacheKey,
          data.workspaceOutputDirectory
        )

  await ensureJobNotCancelled(jobId, job)
  const storeStart = performance.now()
  const storeOutcome = await storeResult(renderResult, timings, data.clientId)
  timings.store = performance.now() - storeStart

  return {
    success: true,
    source: 'generation',
    timings,
    renderPeakMemoryMB: renderResult.renderPeakMemoryMB,
    storeOutcome
  }
}

