/**
 * 概念设计者服务 - 两阶段 AI 生成架构
 * 第一阶段：设计者/思考者 -> 场景设计
 * 第二阶段：代码生成者 -> Manim 代码
 */

import OpenAI from 'openai'
import { createLogger } from '../utils/logger'
import type { CustomApiConfig, OutputMode, PromptOverrides, ReferenceImage } from '../types'
import { createCustomOpenAIClient } from './openai-client-factory'
import { generateSceneDesignStage } from './concept-designer/scene-design-stage'
import { generateCodeFromDesignStage } from './concept-designer/code-from-design-stage'

const logger = createLogger('ConceptDesigner')

const DESIGNER_TEMPERATURE = parseFloat(process.env.DESIGNER_TEMPERATURE || '0.8')
const CODER_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '12000', 10)
const THINKING_TOKENS = parseInt(process.env.AI_THINKING_TOKENS || '20000', 10)
const DESIGNER_MAX_TOKENS = parseInt(process.env.DESIGNER_MAX_TOKENS || '12000', 10)
const DESIGNER_THINKING_TOKENS = parseInt(process.env.DESIGNER_THINKING_TOKENS || '20000', 10)

function createCustomClient(config: CustomApiConfig): OpenAI {
  return createCustomOpenAIClient(config)
}

/**
 * 两阶段 AI 生成
 * 1. 设计者生成场景设计方案
 * 2. 代码生成者根据设计方案生成代码
 */
export async function generateTwoStageAIManimCode(
  concept: string,
  outputMode: OutputMode,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides,
  referenceImages?: ReferenceImage[],
  onCheckpoint?: () => Promise<void>
): Promise<{ code: string; sceneDesign: string }> {
  logger.info('开始两阶段 AI 生成流程', {
    concept,
    outputMode,
    hasImages: !!referenceImages?.length
  })

  if (!customApiConfig) {
    throw new Error('No upstream AI is configured for this request')
  }
  const model = (customApiConfig.model || '').trim()
  if (!model) {
    throw new Error('No model available')
  }

  const client = createCustomClient(customApiConfig)
  if (onCheckpoint) await onCheckpoint()

  const sceneDesign = await generateSceneDesignStage({
    client,
    concept,
    outputMode,
    model,
    promptOverrides,
    referenceImages,
    designerTemperature: DESIGNER_TEMPERATURE,
    designerMaxTokens: DESIGNER_MAX_TOKENS,
    designerThinkingTokens: DESIGNER_THINKING_TOKENS,
    onCheckpoint
  })

  if (!sceneDesign) {
    logger.warn('场景设计方案生成失败，中止流程')
    throw new Error('Scene design stage returned empty result')
  }
  if (onCheckpoint) await onCheckpoint()

  const code = await generateCodeFromDesignStage({
    client,
    concept,
    outputMode,
    sceneDesign,
    model,
    promptOverrides,
    coderTemperature: CODER_TEMPERATURE,
    maxTokens: MAX_TOKENS,
    thinkingTokens: THINKING_TOKENS,
    onCheckpoint
  })

  logger.info('两阶段 AI 生成流程完成', {
    concept,
    hasSceneDesign: !!sceneDesign,
    hasCode: !!code
  })

  if (!code || !code.trim()) {
    throw new Error('Code generation stage returned empty code')
  }

  return { code, sceneDesign }
}

export function isOpenAIAvailable(): boolean {
  return true
}
