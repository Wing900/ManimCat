import OpenAI from 'openai'
import { createLogger } from '../../utils/logger'
import { generateCodeGenerationPrompt, getRoleSystemPrompt } from '../../prompts'
import type { OutputMode, PromptOverrides } from '../../types'
import {
  applyPromptTemplate,
  buildCompletionDiagnostics,
  extractCodeFromResponse,
  generateUniqueSeed,
  normalizeMessageContent
} from '../concept-designer-utils'
import { createChatCompletionText } from '../openai-stream'
import { buildTokenParams } from '../../utils/reasoning-model'
import { JobCancelledError } from '../../utils/errors'
import { executeAiStageWithTransportRetry } from '../ai-stage-transport-retry'

const logger = createLogger('CodeFromDesignStage')
const TRANSPORT_MAX_ATTEMPTS = parseInt(process.env.CODE_GENERATION_TRANSPORT_ATTEMPTS || '2', 10)

interface CodeFromDesignStageParams {
  client: OpenAI
  concept: string
  outputMode: OutputMode
  sceneDesign: string
  model: string
  promptOverrides?: PromptOverrides
  coderTemperature: number
  maxTokens: number
  thinkingTokens: number
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
    const seed = generateUniqueSeed(`${concept}-${sceneDesign.slice(0, 20)}`)
    const systemPrompt = getRoleSystemPrompt('codeGeneration', promptOverrides)
    const userPromptOverride = promptOverrides?.roles?.codeGeneration?.user
    const userPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, seed, sceneDesign, outputMode }, promptOverrides)
      : generateCodeGenerationPrompt(concept, seed, sceneDesign, outputMode)

    logger.info('开始阶段2：根据设计方案生成代码', { concept, outputMode, seed })
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
