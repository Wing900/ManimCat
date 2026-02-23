import { generateEditedManimCode } from '../../services/code-edit'
import { ensureJobNotCancelled } from '../../services/job-cancel'
import { analyzeAndGenerate } from './steps/analysis-step'
import { handlePreGeneratedCode, renderImages, renderVideo } from './steps/render-step'
import { storeResult } from './steps/storage-step'
import { storeProcessingStage } from './video-processor-utils'
import type { PromptOverrides, VideoJobData } from '../../types'

interface FlowResult {
  success: true
  source: 'pre-generated' | 'ai-edit' | 'generation'
  timings: Record<string, number>
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
    throw new Error('缺少 preGeneratedCode')
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

  const storeStart = Date.now()
  await storeResult(renderResult, timings)
  timings.store = Date.now() - storeStart
  timings.total = (timings.render || 0) + (timings.store || 0)

  return { success: true, source: 'pre-generated', timings }
}

export async function runEditFlow(args: BaseFlowArgs): Promise<FlowResult> {
  const { job, data, promptOverrides, timings } = args
  const { jobId, concept, quality, outputMode = 'video', editCode, editInstructions } = data

  if (!editCode || !editInstructions) {
    throw new Error('缺少编辑输入')
  }

  await ensureJobNotCancelled(jobId, job)
  await storeProcessingStage(jobId, 'generating')

  const editStart = Date.now()
  const editedCode = await generateEditedManimCode(
    concept,
    editInstructions,
    editCode,
    outputMode,
    data.customApiConfig,
    promptOverrides
  )
  timings.edit = Date.now() - editStart

  if (!editedCode) {
    throw new Error('AI 修改未返回有效代码')
  }

  await ensureJobNotCancelled(jobId, job)
  const renderStart = Date.now()
  const generationResult = {
    manimCode: editedCode,
    usedAI: true,
    generationType: 'ai-edit'
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
          () => storeProcessingStage(jobId, 'rendering')
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
          () => storeProcessingStage(jobId, 'rendering')
        )
  timings.render = Date.now() - renderStart

  const storeStart = Date.now()
  await storeResult(renderResult, timings)
  timings.store = Date.now() - storeStart
  timings.total = (timings.edit || 0) + (timings.render || 0) + (timings.store || 0)

  return { success: true, source: 'ai-edit', timings }
}

export async function runGenerationFlow(args: BaseFlowArgs): Promise<FlowResult> {
  const { job, data, promptOverrides, timings } = args
  const { jobId, concept, quality, outputMode = 'video', referenceImages } = data

  await ensureJobNotCancelled(jobId, job)
  await storeProcessingStage(jobId, 'generating')

  const analyzeStart = Date.now()
  const codeResult = await analyzeAndGenerate(
    jobId,
    concept,
    quality,
    outputMode,
    timings,
    data.customApiConfig,
    promptOverrides,
    referenceImages
  )
  timings.analyze = Date.now() - analyzeStart

  await ensureJobNotCancelled(jobId, job)
  const renderStart = Date.now()
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
          () => storeProcessingStage(jobId, 'rendering')
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
          () => storeProcessingStage(jobId, 'rendering')
        )
  timings.render = Date.now() - renderStart

  await ensureJobNotCancelled(jobId, job)
  const storeStart = Date.now()
  await storeResult(renderResult, timings)
  timings.store = Date.now() - storeStart
  timings.total = (timings.analyze || 0) + (timings.render || 0) + (timings.store || 0)

  return { success: true, source: 'generation', timings }
}
