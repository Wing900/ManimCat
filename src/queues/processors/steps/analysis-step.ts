/**
 * 概念分析步骤
 * 分析用户输入，决定生成策略
 */

import { generateTwoStageAIManimCode } from '../../../services/concept-designer'
import { ensureJobNotCancelled } from '../../../services/job-cancel'
import { createLogger } from '../../../utils/logger'
import type { CustomApiConfig, OutputMode, PromptOverrides, ReferenceImage } from '../../../types'

const logger = createLogger('AnalysisStep')

/**
 * 概念分析结果
 */
export interface AnalysisResult {
  analysisType: 'latex' | 'template' | 'ai' | 'fallback'
  manimCode: string | null
  needsAI: boolean
}

/**
 * 代码生成结果
 */
export interface GenerationResult {
  manimCode: string
  usedAI: boolean
  generationType: string
  sceneDesign?: string // 保存场景设计方案，用于重试
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

  // 始终走 AI 生成，禁用 LaTeX/模板快捷路径，确保输出为完整动画设计而非固定模板。
  logger.info('Using AI for all concepts (template shortcuts disabled)', { jobId, outputMode })
  return {
    analysisType: 'ai',
    manimCode: null,
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
  referenceImages?: ReferenceImage[]
): Promise<GenerationResult> {
  const { analysisType, manimCode, needsAI } = analyzeResult
  logger.info('Generating code', { jobId, outputMode, needsAI, analysisType, hasImages: !!referenceImages?.length })

  if (needsAI) {
    // 使用两阶段 AI 生成：概念设计者 + 代码生成者
    try {
      logger.info('使用两阶段 AI 生成', { jobId, hasImages: !!referenceImages?.length })
      const result = await generateTwoStageAIManimCode(
        concept,
        outputMode,
        customApiConfig,
        promptOverrides,
        referenceImages,
        () => ensureJobNotCancelled(jobId)
      )
      if (result.code && result.code.length > 0) {
        logger.info('两阶段 AI 代码生成成功', { jobId, length: result.code.length, hasSceneDesign: !!result.sceneDesign })
        return {
          manimCode: result.code,
          usedAI: true,
          generationType: 'two-stage-ai',
          sceneDesign: result.sceneDesign
        }
      }
      throw new Error('两阶段 AI 未返回有效代码')
    } catch (error) {
      logger.error('AI generation failed', { jobId, error: String(error) })
      throw error
    }
  }

  if (manimCode) {
    logger.info('Using pre-generated code', { jobId, length: manimCode.length })
    return { manimCode, usedAI: false, generationType: analysisType }
  }

  throw new Error('未生成任何可渲染代码')
}

/**
 * 分析并生成（合并分析+生成）
 */
export async function analyzeAndGenerate(
  jobId: string,
  concept: string,
  quality: string,
  outputMode: OutputMode,
  _timings: Record<string, number>,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides,
  referenceImages?: ReferenceImage[]
): Promise<GenerationResult> {
  const analysisResult = await analyzeConcept(jobId, concept, quality, outputMode)
  return generateCode(
    jobId,
    concept,
    quality,
    outputMode,
    analysisResult,
    customApiConfig,
    promptOverrides,
    referenceImages
  )
}
