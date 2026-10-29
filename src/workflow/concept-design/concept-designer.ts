/**
 * 概念设计者服务 - 两阶段 AI 生成架构
 * 第一阶段：设计者/思考者 -> 场景设计
 * 第二阶段：代码生成者 -> Manim 代码
 *
 * 旁白开启时，场景设计阶段额外产出 cue plan；随后代码生成与旁白/TTS 两条 Promise 并行，
 * 代码只引用 cue id，真实秒数由渲染 runtime 从后端 manifest 读取。
 */

import OpenAI from 'openai'
import { createLogger } from '../../shared/logging/logger'
import type { CustomApiConfig, OutputMode, PromptOverrides, ReferenceImage, ProblemFramingPlan } from '../../types'
import { createCustomOpenAIClient } from '../../infrastructure/ai-provider/provider-client-factory'
import { readMaxCompletionTokens } from '../../infrastructure/ai-provider/completion-policy'
import { generateSceneDesignStage } from './scene-design-stage'
import { generateCodeFromDesignStage } from './code-from-design-stage'
import type { CuePlan, NarrationAssets, NarrationConfig } from '../narration/types'
import { parseCuePlan } from '../narration/cue-plan'
import { generateNarrationStage } from '../narration/narration-stage'
import { prepareNarration } from '../narration/prepare-narration'

const logger = createLogger('ConceptDesigner')

const DESIGNER_TEMPERATURE = parseFloat(process.env.DESIGNER_TEMPERATURE || '0.8')
const CODER_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = readMaxCompletionTokens()
const DESIGNER_MAX_TOKENS = readMaxCompletionTokens('DESIGNER')

/** Backend-resolved narration inputs. The frontend never supplies any of these paths. */
export interface TwoStageNarrationOptions {
  config: NarrationConfig
  outputDirectory: string
  signal?: AbortSignal
  /** Called as soon as either parallel branch fails, so the other branch stops early. */
  abort?: () => void
}

export interface TwoStageGenerationResult {
  code: string
  sceneDesign: string
  narration?: NarrationAssets
}

function createCustomClient(config: CustomApiConfig): OpenAI {
  return createCustomOpenAIClient(config)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 两阶段 AI 生成
 * 1. 设计者生成场景设计方案（旁白开启时含 cue plan）
 * 2. 代码生成者与旁白/TTS 并行
 */
export async function generateTwoStageAIManimCode(
  concept: string,
  outputMode: OutputMode,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides,
  referenceImages?: ReferenceImage[],
  onCheckpoint?: () => Promise<void>,
  problemPlan?: ProblemFramingPlan,
  onStage?: (stage: 'designing' | 'generating' | 'narrating') => Promise<void>,
  narration?: TwoStageNarrationOptions
): Promise<TwoStageGenerationResult> {
  const narrationEnabled = Boolean(narration?.config.enabled)
  logger.info('开始两阶段 AI 生成流程', {
    concept,
    outputMode,
    hasImages: !!referenceImages?.length,
    narration: narrationEnabled
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

  if (onStage) await onStage('designing')

  const sceneDesign = await generateSceneDesignStage({
    problemPlan,
    client,
    concept,
    outputMode,
    model,
    promptOverrides,
    referenceImages,
    designerTemperature: DESIGNER_TEMPERATURE,
    designerMaxTokens: DESIGNER_MAX_TOKENS,
    onCheckpoint,
    narrationConfig: narrationEnabled ? narration!.config : undefined
  })

  if (!sceneDesign) {
    logger.warn('场景设计方案生成失败，中止流程')
    throw new Error('Scene design stage returned empty result')
  }
  if (onCheckpoint) await onCheckpoint()

  let cuePlan: CuePlan | undefined
  if (narrationEnabled) {
    try {
      cuePlan = parseCuePlan(sceneDesign)
    } catch (error) {
      throw new Error(`Narration cue plan is invalid: ${errorMessage(error)}`)
    }
  }

  if (onStage) await onStage(narrationEnabled ? 'narrating' : 'generating')

  const codePromise = generateCodeFromDesignStage({
    problemPlan,
    client,
    concept,
    outputMode,
    sceneDesign,
    model,
    promptOverrides,
    coderTemperature: CODER_TEMPERATURE,
    maxTokens: MAX_TOKENS,
    onCheckpoint,
    cuePlan
  }).catch((error: unknown) => {
    // Code generation has no signal; at least stop TTS so a doomed job stops spending network.
    narration?.abort?.()
    throw error
  })

  const narrationPromise: Promise<NarrationAssets | undefined> = narrationEnabled
    ? (async () => {
        const plan = await generateNarrationStage({
          client,
          model,
          cuePlan: cuePlan!,
          promptOverrides,
          config: narration!.config,
          onCheckpoint
        })
        if (onCheckpoint) await onCheckpoint()
        return prepareNarration({
          plan,
          outputDirectory: narration!.outputDirectory,
          config: narration!.config,
          signal: narration!.signal
        })
      })()
    : Promise.resolve(undefined)

  const [codeOutcome, narrationOutcome] = await Promise.allSettled([codePromise, narrationPromise])

  if (codeOutcome.status === 'rejected') {
    throw codeOutcome.reason
  }

  let narrationAssets: NarrationAssets | undefined
  if (narrationEnabled) {
    if (narrationOutcome.status === 'rejected') {
      throw new Error(`Narration stage failed: ${errorMessage(narrationOutcome.reason)}`)
    }
    narrationAssets = narrationOutcome.value
    if (!narrationAssets?.manifestPath || !narrationAssets.audioPath || !(narrationAssets.duration > 0)) {
      throw new Error('Narration stage returned incomplete assets')
    }
  }

  const code = codeOutcome.value
  logger.info('两阶段 AI 生成流程完成', {
    concept,
    hasSceneDesign: !!sceneDesign,
    hasCode: !!code,
    hasNarration: !!narrationAssets,
    narrationDuration: narrationAssets?.duration
  })

  if (!code || !code.trim()) {
    throw new Error('Code generation stage returned empty code')
  }

  return { code, sceneDesign, narration: narrationAssets }
}

export function isOpenAIAvailable(): boolean {
  return true
}
