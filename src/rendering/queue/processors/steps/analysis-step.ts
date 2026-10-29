/**
 * 概念分析步骤
 * 分析用户输入，决定生成策略
 */

import { performance } from 'node:perf_hooks'
import { generateTwoStageAIManimCode } from '../../../../workflow/concept-design/concept-designer'
import { storeProcessingStage } from '../video-processor-utils'
import { ensureJobNotCancelled } from '../../../job/job-cancel'
import { isJobCancelled } from '../../../job/job-cancel-store'
import { cleanupNarrationWorkspace } from '../../../manim/narration-mixer'
import { createLogger } from '../../../../shared/logging/logger'
import type { NarrationAssets, NarrationConfig } from '../../../../workflow/narration/types'
import type { CustomApiConfig, OutputMode, PromptOverrides, ReferenceImage, ProblemFramingPlan } from '../../../../types'

const logger = createLogger('AnalysisStep')

/** Server-resolved narration input for one generation run. */
export interface NarrationStageRequest {
  config: NarrationConfig
  outputDirectory: string
}

/**
 * 概念分析结果
 */
export interface AnalysisResult {
  analysisType: 'latex' | 'template' | 'ai' | 'fallback'
  code: string | null
  needsAI: boolean
}

/**
 * 代码生成结果
 */
export interface GenerationResult {
  code: string
  usedAI: boolean
  generationType: string
  sceneDesign?: string
  problemPlan?: ProblemFramingPlan
  narration?: NarrationAssets
}

/**
 * 分析概念
 */
export async function analyzeConcept(
  jobId: string,
  concept: string,
  _quality: string,
  outputMode: OutputMode
): Promise<AnalysisResult> {
  logger.info('Analyzing concept', { jobId, concept, outputMode })

  logger.info('Using AI for all concepts (template shortcuts disabled)', { jobId, outputMode })
  return {
    analysisType: 'ai',
    code: null,
    needsAI: true
  }
}

/**
 * 生成代码
 */
export async function generateCode(
  jobId: string,
  concept: string,
  _quality: string,
  outputMode: OutputMode,
  analyzeResult: AnalysisResult,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides,
  referenceImages?: ReferenceImage[],
  problemPlan?: ProblemFramingPlan,
  narration?: NarrationStageRequest
): Promise<GenerationResult> {
  const { analysisType, code, needsAI } = analyzeResult
  logger.info('Generating code', { jobId, outputMode, needsAI, analysisType, hasImages: !!referenceImages?.length })

  if (needsAI) {
    const narrationAbort = new AbortController()
    let cancellationWatcher: NodeJS.Timeout | undefined
    if (narration) {
      // The LLM stages checkpoint through `ensureJobNotCancelled`; TTS is a separate child process,
      // so give it a durable signal and turn the Redis marker into an abort.
      cancellationWatcher = setInterval(() => {
        void isJobCancelled(jobId)
          .then((cancelled) => {
            if (cancelled) narrationAbort.abort()
          })
          .catch(() => undefined)
      }, 1000)
      cancellationWatcher.unref?.()
    }

    try {
      logger.info('Using two-stage AI generation', {
        jobId,
        hasImages: !!referenceImages?.length,
        narration: !!narration
      })
      const result = await generateTwoStageAIManimCode(
        concept,
        outputMode,
        customApiConfig,
        promptOverrides,
        referenceImages,
        () => ensureJobNotCancelled(jobId),
        problemPlan,
        async (stage) => {
          await storeProcessingStage(jobId, stage, { status: 'processing' })
        },
        narration
          ? {
              config: narration.config,
              outputDirectory: narration.outputDirectory,
              signal: narrationAbort.signal,
              abort: () => narrationAbort.abort()
            }
          : undefined
      )
      if (result.code && result.code.length > 0) {
        logger.info('Two-stage AI code generation succeeded', {
          jobId,
          length: result.code.length,
          hasSceneDesign: !!result.sceneDesign,
          hasNarration: !!result.narration
        })
        return {
          code: result.code,
          usedAI: true,
          generationType: 'two-stage-ai',
          sceneDesign: result.sceneDesign,
          problemPlan,
          narration: result.narration
        }
      }
      throw new Error('Two-stage AI returned an empty code result')
    } catch (error) {
      narrationAbort.abort()
      if (narration) {
        cleanupNarrationWorkspace(narration.outputDirectory)
      }
      // A cancelled TTS run must surface as JobCancelledError (with the stored reason), not as a
      // generic narration failure that Bull might retry.
      if (narration && await isJobCancelled(jobId)) {
        await ensureJobNotCancelled(jobId)
      }
      logger.error('AI generation failed', { jobId, error: String(error) })
      throw error
    } finally {
      if (cancellationWatcher) clearInterval(cancellationWatcher)
    }
  }

  if (code) {
    logger.info('Using pre-generated code', { jobId, length: code.length })
    return { code, usedAI: false, generationType: analysisType, problemPlan }
  }

  throw new Error('No renderable code was generated')
}

/**
 * 分析并生成（合并分析+生成）
 */
export async function analyzeAndGenerate(
  jobId: string,
  concept: string,
  quality: string,
  outputMode: OutputMode,
  timings: Record<string, number>,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides,
  referenceImages?: ReferenceImage[],
  problemPlan?: ProblemFramingPlan,
  narration?: NarrationStageRequest
): Promise<GenerationResult> {
  const analyzeStart = performance.now()
  const analysisResult = await analyzeConcept(jobId, concept, quality, outputMode)
  timings.analyze = performance.now() - analyzeStart

  const generateStart = performance.now()
  try {
    return await generateCode(
      jobId,
      concept,
      quality,
      outputMode,
      analysisResult,
      customApiConfig,
      promptOverrides,
      referenceImages,
      problemPlan,
      narration
    )
  } finally {
    timings.generate = performance.now() - generateStart
  }
}
