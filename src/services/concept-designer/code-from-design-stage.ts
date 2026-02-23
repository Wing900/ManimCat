import OpenAI from 'openai'
import { createLogger } from '../../utils/logger'
import { SYSTEM_PROMPTS, generateCodeGenerationPrompt } from '../../prompts'
import type { OutputMode, PromptOverrides } from '../../types'
import {
  applyPromptTemplate,
  buildCompletionDiagnostics,
  extractCodeFromResponse,
  generateUniqueSeed,
  normalizeMessageContent
} from '../concept-designer-utils'

const logger = createLogger('CodeFromDesignStage')

interface CodeFromDesignStageParams {
  client: OpenAI
  concept: string
  outputMode: OutputMode
  sceneDesign: string
  model: string
  promptOverrides?: PromptOverrides
  coderTemperature: number
  maxTokens: number
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
    onCheckpoint
  } = params

  try {
    const seed = generateUniqueSeed(`${concept}-${sceneDesign.slice(0, 20)}`)
    const systemPrompt = promptOverrides?.roles?.codeGeneration?.system || SYSTEM_PROMPTS.codeGeneration
    const userPromptOverride = promptOverrides?.roles?.codeGeneration?.user
    const userPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, seed, sceneDesign, outputMode }, promptOverrides)
      : generateCodeGenerationPrompt(concept, seed, sceneDesign, outputMode)

    logger.info('开始阶段2：根据设计方案生成代码', { concept, outputMode, seed })
    if (onCheckpoint) await onCheckpoint()

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: coderTemperature,
      max_tokens: maxTokens
    })
    if (onCheckpoint) await onCheckpoint()

    const content = normalizeMessageContent(response.choices[0]?.message?.content)
    if (!content) {
      logger.warn('代码生成者返回空内容', {
        concept,
        seed,
        model,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        diagnostics: buildCompletionDiagnostics(response)
      })
      return ''
    }

    logger.info('阶段2：代码生成成功', { concept, seed, codeLength: content.length })

    if (outputMode === 'image') {
      return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    }

    return extractCodeFromResponse(content)
  } catch (error) {
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
    return ''
  }
}
