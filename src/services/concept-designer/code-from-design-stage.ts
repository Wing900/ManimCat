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
 * \u9636\u6BB52\uFF1A\u4EE3\u7801\u751F\u6210\u8005
 * \u63A5\u6536\u573A\u666F\u8BBE\u8BA1\u65B9\u6848\uFF0C\u8F93\u51FA Manim \u4EE3\u7801
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
    const systemPrompt = getRoleSystemPrompt('codeGeneration', promptOverrides)
    const userPromptOverride = promptOverrides?.roles?.codeGeneration?.user
    const userPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, seed, sceneDesign, outputMode }, promptOverrides)
      : generateCodeGenerationPrompt(concept, seed, sceneDesign, outputMode)

    logger.info('\u5F00\u59CB\u9636\u6BB52\uFF1A\u6839\u636E\u8BBE\u8BA1\u65B9\u6848\u751F\u6210\u4EE3\u7801', { concept, outputMode, seed })
    if (onCheckpoint) await onCheckpoint()

    const { content, mode, response } = await createChatCompletionText(
      client,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: coderTemperature,
        max_tokens: maxTokens
      },
      { fallbackToNonStream: true, usageLabel: 'code-generation' }
    )
    if (onCheckpoint) await onCheckpoint()

    const normalizedContent = normalizeMessageContent(content)
    if (!normalizedContent) {
      logger.warn('\u4EE3\u7801\u751F\u6210\u8005\u8FD4\u56DE\u7A7A\u5185\u5BB9', {
        concept,
        seed,
        mode,
        model,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        diagnostics: response ? buildCompletionDiagnostics(response) : { mode: 'stream' }
      })
      return ''
    }

    logger.info('\u9636\u6BB52\uFF1A\u4EE3\u7801\u751F\u6210\u6210\u529F', { concept, seed, mode, codeLength: normalizedContent.length })

    if (outputMode === 'image') {
      return normalizedContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    }

    return extractCodeFromResponse(normalizedContent)
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('\u4EE3\u7801\u751F\u6210\u8005 API \u9519\u8BEF', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message
      })
    } else if (error instanceof Error) {
      logger.error('\u4EE3\u7801\u751F\u6210\u8005\u5931\u8D25', {
        concept,
        errorName: error.name,
        errorMessage: error.message
      })
    } else {
      logger.error('\u4EE3\u7801\u751F\u6210\u8005\u5931\u8D25\uFF08\u672A\u77E5\u9519\u8BEF\uFF09', { concept, error: String(error) })
    }
    return ''
  }
}
