import OpenAI from 'openai'
import { createLogger } from '../../utils/logger'
import { cleanManimCode } from '../../utils/manim-code-cleaner'
import { getClient } from './client'
import { extractCodeFromResponse } from './utils'
import type { CodeRetryContext } from './types'
import { buildRetryPrompt, getCodeRetrySystemPrompt } from './prompt-builder'
import { dedupeSharedBlocksInMessages } from '../prompt-dedup'
import { createChatCompletionText } from '../openai-stream'

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
    throw new Error('OpenAI \u5BA2\u6237\u7AEF\u4E0D\u53EF\u7528')
  }

  try {
    const requestMessages = dedupeSharedBlocksInMessages(
      [
        { role: 'system', content: getCodeRetrySystemPrompt(context.promptOverrides) },
        { role: 'user', content: context.originalPrompt }
      ],
      context.promptOverrides
    )

    const { content, mode } = await createChatCompletionText(
      client,
      {
        model: getModel(customApiConfig),
        messages: requestMessages,
        temperature: AI_TEMPERATURE,
        max_tokens: MAX_TOKENS
      },
      { fallbackToNonStream: true, usageLabel: 'retry-initial' }
    )

    if (!content) {
      throw new Error('AI \u8FD4\u56DE\u7A7A\u5185\u5BB9')
    }

    const code = extractCodeFromResponse(content, context.outputMode)
    const cleaned = cleanManimCode(code)

    logger.info('\u9996\u6B21\u4EE3\u7801\u751F\u6210\u6210\u529F', {
      concept: context.concept,
      mode,
      codeLength: cleaned.code.length
    })

    return cleaned.code
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API \u9519\u8BEF', {
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
  currentCode: string,
  customApiConfig?: unknown
): Promise<string> {
  const client = getClient(customApiConfig as any)
  if (!client) {
    throw new Error('OpenAI \u5BA2\u6237\u7AEF\u4E0D\u53EF\u7528')
  }

  const retryPrompt = buildRetryPrompt(context, errorMessage, attempt, currentCode)

  try {
    const requestMessages = dedupeSharedBlocksInMessages(
      [
        { role: 'system', content: getCodeRetrySystemPrompt(context.promptOverrides) },
        { role: 'user', content: retryPrompt }
      ],
      context.promptOverrides
    )

    const { content, mode } = await createChatCompletionText(
      client,
      {
        model: getModel(customApiConfig),
        messages: requestMessages,
        temperature: AI_TEMPERATURE,
        max_tokens: MAX_TOKENS
      },
      { fallbackToNonStream: true, usageLabel: `retry-${attempt}` }
    )

    if (!content) {
      throw new Error('AI \u8FD4\u56DE\u7A7A\u5185\u5BB9')
    }

    const code = extractCodeFromResponse(content, context.outputMode)
    const cleaned = cleanManimCode(code)

    logger.info('\u4EE3\u7801\u91CD\u8BD5\u751F\u6210\u6210\u529F', {
      concept: context.concept,
      attempt,
      mode,
      codeLength: cleaned.code.length
    })

    return cleaned.code
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API \u9519\u8BEF\uFF08\u91CD\u8BD5\uFF09', {
        attempt,
        status: error.status,
        message: error.message
      })
    }
    throw error
  }
}
