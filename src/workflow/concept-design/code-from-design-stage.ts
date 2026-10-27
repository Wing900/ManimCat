import OpenAI from 'openai'
import { createLogger } from '../../shared/logging/logger'
import { getRoleUserPrompt, getRoleSystemPrompt } from '../../prompts'
import type { OutputMode, PromptOverrides, ProblemFramingPlan } from '../../types'
import { formatProblemFramingPlan } from '../generation/request-preparation'
import {
  buildCompletionDiagnostics,
  extractCodeFromResponse,
  generateUniqueSeed,
  normalizeMessageContent
} from './concept-designer-utils'
import { createChatCompletionText } from '../openai-stream'
import { buildTokenParams } from '../../utils/reasoning-model'
import { JobCancelledError } from '../../shared/errors/errors'
import { executeAiStageWithTransportRetry } from '../ai-stage-transport-retry'
import { parseCuePlan, stripCuePlan } from '../narration/cue-plan'
import type { CuePlan } from '../narration/types'

const logger = createLogger('CodeFromDesignStage')
const TRANSPORT_MAX_ATTEMPTS = parseInt(process.env.CODE_GENERATION_TRANSPORT_ATTEMPTS || '2', 10)

interface CodeFromDesignStageParams {
  client: OpenAI
  concept: string
  problemPlan?: ProblemFramingPlan
  outputMode: OutputMode
  sceneDesign: string
  model: string
  promptOverrides?: PromptOverrides
  coderTemperature: number
  maxTokens: number
  thinkingTokens: number
  /** Fixed cue IDs for narration sync. Runtime injects the helpers; no seconds here. */
  cuePlan?: CuePlan
  onCheckpoint?: () => Promise<void>
}

/**
 * 阶段2：代码生成者
 * 接收场景设计方案，输出 Manim 代码
 */
export async function generateCodeFromDesignStage(params: CodeFromDesignStageParams): Promise<string> {
  const {
    client,
    concept,
    outputMode,
    sceneDesign,
    model,
    promptOverrides,
    coderTemperature,
    maxTokens,
    thinkingTokens,
    onCheckpoint
  } = params

  try {
    // The storyboard may carry the narration block; the coder reads it as cue IDs,
    // never as duplicated raw JSON inside the four storyboard sections.
    const cuePlan = params.cuePlan
      ?? (/<cue_plan>/i.test(sceneDesign) ? parseCuePlan(sceneDesign) : undefined)
    const coderSceneDesign = cuePlan ? stripCuePlan(sceneDesign) : sceneDesign
    const seed = generateUniqueSeed(`${concept}-${sceneDesign.slice(0, 20)}`)
    const systemPrompt = getRoleSystemPrompt('codeGeneration', promptOverrides)
    const userPrompt = getRoleUserPrompt('codeGeneration', {
      concept, seed, sceneDesign: coderSceneDesign, outputMode, plan: formatProblemFramingPlan(params.problemPlan),
      isVideo: outputMode === 'video', isImage: outputMode === 'image',
      narrationEnabled: !!cuePlan,
      narrationCuePlan: cuePlan ? JSON.stringify(cuePlan, null, 2) : undefined,
    }, promptOverrides)

    logger.info('开始阶段2：根据设计方案生成代码', {
      concept,
      outputMode,
      seed,
      narrationEnabled: !!cuePlan,
      cues: cuePlan ? cuePlan.segments.reduce((total, segment) => total + segment.cues.length, 0) : 0
    })
    const { content, mode, response } = await executeAiStageWithTransportRetry(
      (attempt) => createChatCompletionText(
        client,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: coderTemperature,
          ...buildTokenParams(thinkingTokens, maxTokens)
        },
        { fallbackToNonStream: true, usageLabel: `code-generation-${attempt}` }
      ),
      {
        maxAttempts: TRANSPORT_MAX_ATTEMPTS,
        onCheckpoint,
        onRetry: ({ attempt, nextAttempt, maxAttempts: retryLimit, delayMs, error }) => {
          logger.warn('代码生成连接失败，准备重试完整阶段', {
            concept,
            attempt,
            nextAttempt,
            maxAttempts: retryLimit,
            delayMs,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    )
    if (onCheckpoint) await onCheckpoint()

    const normalizedContent = normalizeMessageContent(content)
    if (!normalizedContent) {
      logger.warn('代码生成者返回空内容', {
        concept,
        seed,
        mode,
        model,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        diagnostics: response ? buildCompletionDiagnostics(response) : { mode: 'stream' }
      })
      throw new Error('Code generation stage returned empty content from AI response')
    }

    logger.info('阶段2：代码生成成功', {
      concept,
      seed,
      mode,
      codeLength: normalizedContent.length,
      codePreview: normalizedContent.slice(0, 500)
    })

    if (outputMode === 'image') {
      return normalizedContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    }

    const extractedCode = extractCodeFromResponse(normalizedContent)
    logger.info('阶段2：代码提取完成', {
      concept,
      seed,
      extractedLength: extractedCode.length,
      extractedPreview: extractedCode.slice(0, 500)
    })
    return extractedCode
  } catch (error) {
    if (error instanceof JobCancelledError) {
      logger.warn('代码生成阶段已取消', {
        concept,
        reason: error.details
      })
      throw error
    }

    if (error instanceof OpenAI.APIError) {
      logger.error('代码生成者 API 错误', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message
      })
    } else if (error instanceof Error) {
      logger.error('代码生成者失败', {
        concept,
        errorName: error.name,
        errorMessage: error.message
      })
    } else {
      logger.error('代码生成者失败（未知错误）', { concept, error: String(error) })
    }
    throw new Error(`Code generation stage failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
