import OpenAI from 'openai'
import { createLogger } from '../../utils/logger'
import { cleanManimCode } from '../../utils/manim-code-cleaner'
import { getClient } from './client'
import { extractCodeFromResponse } from './utils'
import type { ChatMessage, CodeRetryContext } from './types'
import { buildRetryPrompt, getCodeRetrySystemPrompt } from './prompt-builder'
import { dedupeSharedBlocksInMessages, stripSharedBlocksFromPrompt } from '../prompt-dedup'

const logger = createLogger('CodeRetryCodeGen')

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'glm-4-flash'
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)

function getModel(customApiConfig?: unknown): string {
  const model = (customApiConfig as { model?: string } | undefined)?.model
  return model?.trim() || OPENAI_MODEL
}

export async function generateInitialCode(
  context: CodeRetryContext,
  customApiConfig?: unknown
): Promise<string> {
  const client = getClient(customApiConfig as any)
  if (!client) {
    throw new Error('OpenAI 客户端不可用')
  }

  try {
    const requestMessages = dedupeSharedBlocksInMessages(
      [
        { role: 'system', content: getCodeRetrySystemPrompt(context.promptOverrides) },
        { role: 'user', content: context.originalPrompt }
      ],
      context.promptOverrides
    )

    const response = await client.chat.completions.create({
      model: getModel(customApiConfig),
      messages: requestMessages,
      temperature: AI_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      throw new Error('AI 返回空内容')
    }

    const code = extractCodeFromResponse(content, context.outputMode)
    const cleaned = cleanManimCode(code)

    const compactOriginalPrompt = stripSharedBlocksFromPrompt(context.originalPrompt, context.promptOverrides)
    context.messages.push(
      { role: 'user', content: compactOriginalPrompt || '请按照系统规则生成可运行代码。' },
      { role: 'assistant', content: code }
    )

    logger.info('首次代码生成成功', {
      concept: context.concept,
      codeLength: cleaned.code.length
    })

    return cleaned.code
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API 错误', {
        status: error.status,
        message: error.message
      })
    }
    throw error
  }
}

export async function retryCodeGeneration(
  context: CodeRetryContext,
  errorMessage: string,
  attempt: number,
  customApiConfig?: unknown
): Promise<string> {
  const client = getClient(customApiConfig as any)
  if (!client) {
    throw new Error('OpenAI 客户端不可用')
  }

  const retryPrompt = buildRetryPrompt(context, errorMessage, attempt)

  try {
    const messages: ChatMessage[] = [
      { role: 'system', content: getCodeRetrySystemPrompt(context.promptOverrides) },
      ...context.messages,
      { role: 'user', content: retryPrompt }
    ]
    const requestMessages = dedupeSharedBlocksInMessages(messages, context.promptOverrides)

    const response = await client.chat.completions.create({
      model: getModel(customApiConfig),
      messages: requestMessages,
      temperature: AI_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      throw new Error('AI 返回空内容')
    }

    const code = extractCodeFromResponse(content, context.outputMode)
    const cleaned = cleanManimCode(code)

    const compactRetryPrompt = stripSharedBlocksFromPrompt(retryPrompt, context.promptOverrides)
    context.messages.push(
      { role: 'user', content: compactRetryPrompt || `请根据错误继续修复（第 ${attempt} 轮）` },
      { role: 'assistant', content: code }
    )

    logger.info('代码重试生成成功', {
      concept: context.concept,
      attempt,
      codeLength: cleaned.code.length
    })

    return cleaned.code
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API 错误（重试）', {
        attempt,
        status: error.status,
        message: error.message
      })
    }
    throw error
  }
}
