/**
 * OpenAI \u5BA2\u6237\u7AEF\u670D\u52A1
 * \u5904\u7406\u57FA\u4E8E AI \u7684 Manim \u4EE3\u7801\u751F\u6210
 * \u4F7F\u7528 GPT-4.1 nano - OpenAI \u6700\u5FEB\u7684\u6A21\u578B\uFF0895.9 tokens/sec\uFF0C\u9996 token <5s\uFF09
 * \u652F\u6301\u901A\u8FC7 CUSTOM_API_URL \u548C CUSTOM_API_KEY \u73AF\u5883\u53D8\u91CF\u4F7F\u7528\u81EA\u5B9A\u4E49 API \u7AEF\u70B9
 */

import OpenAI from 'openai'
import { createLogger } from '../utils/logger'
import type { CustomApiConfig } from '../types'
import {
  createCustomOpenAIClient,
  initializeDefaultOpenAIClient
} from './openai-client-factory'
import { createChatCompletionText } from './openai-stream'
import {
  extractCodeFromResponse,
  generateManimPrompt,
  generateUniqueSeed,
  OPENAI_MANIM_SYSTEM_PROMPT
} from './openai-client-utils'

const logger = createLogger('OpenAIClient')

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'glm-4-flash'
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)

const openaiClient: OpenAI | null = initializeDefaultOpenAIClient((error) => {
  logger.warn('OpenAI \u5BA2\u6237\u7AEF\u521D\u59CB\u5316\u5931\u8D25', { error })
})

export interface BackendTestResult {
  model: string
  content: string
}

/**
 * \u521B\u5EFA\u81EA\u5B9A\u4E49 OpenAI \u5BA2\u6237\u7AEF
 */
function createCustomClient(config: CustomApiConfig): OpenAI {
  return createCustomOpenAIClient(config)
}

/**
 * \u4F7F\u7528 OpenAI \u751F\u6210 Manim \u4EE3\u7801
 * \u4F7F\u7528\u8F83\u9AD8\u7684\u6E29\u5EA6\u4EE5\u83B7\u5F97\u591A\u6837\u5316\u7684\u8F93\u51FA\uFF0C\u5E76\u4E3A\u6BCF\u6B21\u8BF7\u6C42\u4F7F\u7528\u552F\u4E00\u79CD\u5B50
 */
export async function generateAIManimCode(concept: string, customApiConfig?: CustomApiConfig): Promise<string> {
  // \u4F7F\u7528\u81EA\u5B9A\u4E49 API \u6216\u9ED8\u8BA4\u5BA2\u6237\u7AEF
  const client = customApiConfig ? createCustomClient(customApiConfig) : openaiClient

  if (!client) {
    logger.warn('OpenAI \u5BA2\u6237\u7AEF\u4E0D\u53EF\u7528')
    return ''
  }

  try {
    const seed = generateUniqueSeed(concept)

    const systemPrompt = OPENAI_MANIM_SYSTEM_PROMPT

    const userPrompt = generateManimPrompt(concept, seed)

    const model = customApiConfig?.model?.trim() || OPENAI_MODEL

    const { content, mode } = await createChatCompletionText(
      client,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: AI_TEMPERATURE,
        max_tokens: MAX_TOKENS
      },
      { fallbackToNonStream: true, usageLabel: 'single-stage-generation' }
    )

    if (!content) {
      logger.warn('AI \u8FD4\u56DE\u7A7A\u5185\u5BB9')
      return ''
    }

    // \u8BB0\u5F55\u5B8C\u6574\u7684 AI \u54CD\u5E94
    logger.info('AI \u4EE3\u7801\u751F\u6210\u6210\u529F', {
      concept,
      seed,
      mode,
      responseLength: content.length,
      response: content
    })

    const extractedCode = extractCodeFromResponse(content)
    logger.info('\u4EE3\u7801\u63D0\u53D6\u5B8C\u6210', {
      extractedLength: extractedCode.length,
      code: extractedCode
    })

    return extractedCode
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API \u9519\u8BEF', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message,
        headers: JSON.stringify(error.headers),
        cause: error.cause
      })
    } else if (error instanceof Error) {
      logger.error('AI \u751F\u6210\u5931\u8D25', {
        concept,
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      })
    } else {
      logger.error('AI \u751F\u6210\u5931\u8D25\uFF08\u672A\u77E5\u9519\u8BEF\uFF09', { concept, error: String(error) })
    }
    return ''
  }
}

export async function testBackendAIConnection(customApiConfig?: CustomApiConfig): Promise<BackendTestResult> {
  const client = customApiConfig ? createCustomClient(customApiConfig) : openaiClient

  if (!client) {
    throw new Error('OpenAI client is unavailable')
  }

  const model = customApiConfig?.model?.trim() || OPENAI_MODEL

  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0,
    max_tokens: 8
  })

  return {
    model,
    content: response.choices[0]?.message?.content || ''
  }
}

/**
 * Check whether OpenAI client is available
 */
export function isOpenAIAvailable(): boolean {
  return openaiClient !== null
}
