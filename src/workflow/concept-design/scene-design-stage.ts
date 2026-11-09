import OpenAI from 'openai'
import { createLogger } from '../../shared/logging/logger'
import { getRoleUserPrompt, getRoleSystemPrompt } from '../../prompts'
import type { ConceptInput, OutputMode, PromptOverrides, ProblemFramingPlan } from '../../types'
import { formatProblemFramingPlan } from '../generation/request-preparation'
import {
  buildCompletionDiagnostics,
  cleanDesignText,
  extractDesignFromResponse,
  generateUniqueSeed,
  normalizeMessageContent
} from './concept-designer-utils'
import { createChatCompletionText } from '../openai-stream'
import { buildVisionUserMessage } from '../generation/multimodal-input'
import { buildCompletionParams } from '../../infrastructure/ai-provider/completion-policy'
import { JobCancelledError } from '../../shared/errors/errors'
import { NarrationCuePlanError, parseCuePlan } from '../narration/cue-plan'
import type { NarrationConfig } from '../narration/types'

const logger = createLogger('SceneDesignStage')

// Content retry: let AI re-emit on malformed output (max 2 attempts)
const MAX_CONTENT_ATTEMPTS = 2

function repairInstruction(reason: string): string {
  return [
    `你上一条输出的场景设计有问题（${reason}）。请重新输出完整的 <design>...</design> 块；旁白开启时必须在 <design> 块内包含唯一的 <cue_plan>...</cue_plan>。`,
    `Your previous scene design output was invalid (${reason}). Re-emit the complete <design>...</design> block; when narration is enabled, the <design> block must contain exactly one <cue_plan>...</cue_plan>.`
  ].join('\n\n')
}

interface SceneDesignStageParams extends ConceptInput {
  client: OpenAI
  problemPlan?: ProblemFramingPlan
  outputMode: OutputMode
  model: string
  promptOverrides?: PromptOverrides
  designerTemperature: number
  designerMaxTokens: number
  /** Enables the extra <cue_plan> block for Workflow video narration. */
  narrationConfig?: NarrationConfig
  onCheckpoint?: () => Promise<void>
}

export async function generateSceneDesignStage(params: SceneDesignStageParams): Promise<string> {
  const {
    client,
    concept,
    outputMode,
    model,
    promptOverrides,
    referenceImages,
    designerTemperature,
    designerMaxTokens,
    onCheckpoint
  } = params
  // Narration is a Workflow-video feature; image mode never asks for cues.
  const narrationEnabled = params.narrationConfig?.enabled === true && outputMode === 'video'
  let lastError: Error | undefined

  try {
    const seed = generateUniqueSeed(concept)
    const systemPrompt = getRoleSystemPrompt('conceptDesigner', promptOverrides)
    const userPrompt = getRoleUserPrompt('conceptDesigner', {
      concept, seed, outputMode, plan: formatProblemFramingPlan(params.problemPlan),
      isVideo: outputMode === 'video', isImage: outputMode === 'image',
      narrationEnabled,
    }, promptOverrides)

    logger.info('开始阶段1：生成场景设计方案', {
      concept,
      outputMode,
      seed,
      hasImages: !!referenceImages?.length
    })

    // Content retry: let AI re-emit on malformed output (max 2 attempts)
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildVisionUserMessage(userPrompt, referenceImages) }
    ]
    const queueContentRepair = (attempt: number, content: string, reason: string): boolean => {
      if (attempt >= MAX_CONTENT_ATTEMPTS) return false
      if (content.trim()) messages.push({ role: 'assistant', content })
      messages.push({ role: 'user', content: repairInstruction(reason) })
      return true
    }

    for (let attempt = 1; attempt <= MAX_CONTENT_ATTEMPTS; attempt += 1) {
      let content = ''
      let mode: 'stream' | 'stream-partial' | 'non-stream' = 'stream'
      let fallbackResponse: OpenAI.Chat.Completions.ChatCompletion | undefined
      if (onCheckpoint) await onCheckpoint()

      const completion = await createChatCompletionText(
        client,
        {
          model,
          messages,
          temperature: designerTemperature,
          ...buildCompletionParams(designerMaxTokens, 'DESIGNER', client)
        },
        {
          fallbackToNonStream: true,
          usageLabel: attempt === 1 ? 'scene-design' : 'scene-design-repair'
        }
      )
      content = completion.content
      mode = completion.mode
      fallbackResponse = completion.response
      if (onCheckpoint) await onCheckpoint()

      const normalizedContent = normalizeMessageContent(content)
      if (!normalizedContent) {
        logger.warn('设计者返回空内容', {
          concept,
          seed,
          attempt,
          mode,
          model,
          systemPromptLength: systemPrompt.length,
          userPromptLength: userPrompt.length,
          diagnostics: fallbackResponse ? buildCompletionDiagnostics(fallbackResponse) : { mode: 'stream' }
        })
        const reason = 'Scene design stage returned empty content from AI response'
        lastError = new Error(reason)
        logger.warn('场景设计输出未通过内容检查', { concept, attempt, reason })
        if (!queueContentRepair(attempt, content, reason)) break
        continue
      }

      const extractedDesign = extractDesignFromResponse(normalizedContent)
      const cleanedDesign = cleanDesignText(extractedDesign)
      if (cleanedDesign.changes.length > 0) {
        logger.info('设计方案已清洗', {
          concept,
          seed,
          mode,
          changes: cleanedDesign.changes,
          originalLength: normalizedContent.length,
          cleanedLength: cleanedDesign.text.length
        })
      }

      if (!cleanedDesign.text) {
        logger.warn('设计者返回空方案', { concept, attempt })
        const reason = 'Scene design stage produced empty design after cleaning'
        lastError = new Error(reason)
        logger.warn('场景设计输出未通过内容检查', { concept, attempt, reason })
        if (!queueContentRepair(attempt, content, reason)) break
        continue
      }

      if (narrationEnabled) {
        // Fail here rather than handing a malformed cue contract to TTS or the runtime.
        try {
          const cuePlan = parseCuePlan(cleanedDesign.text)
          logger.info('分镜 cue 计划解析成功', {
            concept,
            seed,
            segments: cuePlan.segments.length,
            cues: cuePlan.segments.reduce((total, segment) => total + segment.cues.length, 0)
          })
        } catch (error) {
          if (!(error instanceof NarrationCuePlanError)) throw error
          lastError = error
          logger.warn('场景设计输出未通过内容检查', { concept, attempt, reason: error.message })
          if (!queueContentRepair(attempt, content, error.message)) break
          continue
        }
      }

      logger.info('阶段1：场景设计方案生成成功', {
        concept,
        seed,
        mode,
        attempt,
        designLength: cleanedDesign.text.length
      })

      return cleanedDesign.text
    }
  } catch (error) {
    if (error instanceof JobCancelledError) {
      logger.warn('场景设计阶段已取消', {
        concept,
        reason: error.details
      })
      throw error
    }

    if (error instanceof NarrationCuePlanError) {
      logger.error('分镜 cue 计划无效', { concept, error: error.message })
      throw error
    }

    if (error instanceof OpenAI.APIError) {
      logger.error('设计者 API 错误', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message
      })
    } else if (error instanceof Error) {
      logger.error('设计者生成失败', {
        concept,
        errorName: error.name,
        errorMessage: error.message
      })
    } else {
      logger.error('设计者生成失败（未知错误）', { concept, error: String(error) })
    }
    throw new Error(`Scene design stage failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const finalMessage = `${lastError?.message ?? 'Scene design stage failed'} (after ${MAX_CONTENT_ATTEMPTS} content attempts)`
  if (lastError instanceof NarrationCuePlanError) {
    throw new NarrationCuePlanError(finalMessage)
  }
  throw new Error(finalMessage)
}
