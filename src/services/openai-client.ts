/**
 * OpenAI 客户端服务
 * 处理基于 AI 的 Manim 代码生成
 * 使用 GPT-4.1 nano - OpenAI 最快的模型（95.9 tokens/sec，首 token <5s）
 * 支持通过 CUSTOM_API_URL 和 CUSTOM_API_KEY 环境变量使用自定义 API 端点
 */

import OpenAI from 'openai'
import { createLogger } from '../utils/logger'
import type { CustomApiConfig } from '../types'
import {
  createCustomOpenAIClient,
  initializeDefaultOpenAIClient
} from './openai-client-factory'
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
  logger.warn('OpenAI 客户端初始化失败', { error })
})

export interface BackendTestResult {
  model: string
  content: string
}

/**
 * 创建自定义 OpenAI 客户端
 */
function createCustomClient(config: CustomApiConfig): OpenAI {
  return createCustomOpenAIClient(config)
}

/**
 * 使用 OpenAI 生成 Manim 代码
 * 使用较高的温度以获得多样化的输出，并为每次请求使用唯一种子
 */
export async function generateAIManimCode(concept: string, customApiConfig?: CustomApiConfig): Promise<string> {
  // 使用自定义 API 或默认客户端
  const client = customApiConfig ? createCustomClient(customApiConfig) : openaiClient

  if (!client) {
    logger.warn('OpenAI 客户端不可用')
    return ''
  }

  try {
    const seed = generateUniqueSeed(concept)

    const systemPrompt = OPENAI_MANIM_SYSTEM_PROMPT

    const userPrompt = generateManimPrompt(concept, seed)

    const model = customApiConfig?.model?.trim() || OPENAI_MODEL

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      logger.warn('AI 返回空内容')
      return ''
    }

    // 记录完整的 AI 响应
    logger.info('AI 代码生成成功', {
      concept,
      seed,
      responseLength: content.length,
      response: content
    })

    const extractedCode = extractCodeFromResponse(content)
    logger.info('代码提取完成', {
      extractedLength: extractedCode.length,
      code: extractedCode
    })

    return extractedCode
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API 错误', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message,
        headers: JSON.stringify(error.headers),
        cause: error.cause
      })
    } else if (error instanceof Error) {
      logger.error('AI 生成失败', {
        concept,
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      })
    } else {
      logger.error('AI 生成失败（未知错误）', { concept, error: String(error) })
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
