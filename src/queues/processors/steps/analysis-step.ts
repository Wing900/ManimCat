/**
 * 概念分析步骤
 * 分析用户输入，决定生成策略
 */

import {
  isLikelyLatex,
  selectTemplate,
  generateLatexSceneCode
} from '../../../services/manim-templates'
import { generateAIManimCode } from '../../../services/openai-client'
import { createLogger } from '../../../utils/logger'
import type { CustomApiConfig } from '../../../types'

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
}

/**
 * 分析概念
 */
export async function analyzeConcept(
  jobId: string,
  concept: string,
  _quality: string
): Promise<AnalysisResult> {
  logger.info('Analyzing concept', { jobId, concept })

  // 检查是否为 LaTeX
  if (isLikelyLatex(concept)) {
    logger.info('Detected LaTeX', { jobId })
    return {
      analysisType: 'latex',
      manimCode: generateLatexSceneCode(concept),
      needsAI: false
    }
  }

  // 尝试匹配模板
  const templateResult = selectTemplate(concept)
  if (templateResult) {
    logger.info('Matched template', { jobId, template: templateResult.templateName })
    return {
      analysisType: 'template',
      manimCode: templateResult.code,
      needsAI: false
    }
  }

  // 需要 AI 生成
  logger.info('Using AI for unique output', { jobId })
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
  analyzeResult: AnalysisResult,
  customApiConfig?: CustomApiConfig
): Promise<GenerationResult> {
  const { analysisType, manimCode, needsAI } = analyzeResult
  logger.info('Generating code', { jobId, needsAI, analysisType })

  // 基本可视化代码（fallback）
  const basicVisualizationCode = `from manim import *

class MainScene(Scene):
    def construct(self):
        text = Text("Animation for: ${concept}")
        self.play(Write(text))
        self.wait(1)
`.replace('${concept}', concept)

  if (needsAI) {
    // 使用 AI 生成
    try {
      const aiCode = await generateAIManimCode(concept, customApiConfig)
      if (aiCode && aiCode.length > 0) {
        logger.info('AI code generated', { jobId, length: aiCode.length, hasCustomApi: !!customApiConfig })
        return { manimCode: aiCode, usedAI: true, generationType: customApiConfig ? 'custom-api' : 'ai' }
      }
    } catch (error) {
      logger.warn('AI generation failed, using fallback', { jobId })
    }
    return { manimCode: basicVisualizationCode, usedAI: false, generationType: 'fallback' }
  }

  if (manimCode) {
    logger.info('Using pre-generated code', { jobId, length: manimCode.length })
    return { manimCode, usedAI: false, generationType: analysisType }
  }

  return { manimCode: basicVisualizationCode, usedAI: false, generationType: 'fallback' }
}

/**
 * 分析并生成（合并分析+生成）
 */
export async function analyzeAndGenerate(
  jobId: string,
  concept: string,
  quality: string,
  _timings: Record<string, number>,
  customApiConfig?: CustomApiConfig
): Promise<GenerationResult> {
  const analysisResult = await analyzeConcept(jobId, concept, quality)
  return generateCode(jobId, concept, quality, analysisResult, customApiConfig)
}
