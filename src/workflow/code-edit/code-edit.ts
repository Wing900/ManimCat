import OpenAI from 'openai'
import { createLogger } from '../../shared/logging/logger'
import { generateCodeEditPrompt, getRoleSystemPrompt, getSharedModule } from '../../prompts'
import type { CustomApiConfig, OutputMode, PromptOverrides } from '../../types'
import { createCustomOpenAIClient } from '../../infrastructure/ai-provider/provider-client-factory'
import { createChatCompletionText } from '../openai-stream'
import { buildCompletionParams, readMaxCompletionTokens } from '../../infrastructure/ai-provider/completion-policy'

const logger = createLogger('CodeEditService')

const CODER_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = readMaxCompletionTokens()
// Content retry: let AI re-emit on malformed output (max 2 attempts)
const MAX_CONTENT_ATTEMPTS = 2

function repairInstruction(reason: string): string {
  return [
    `你上一条修改后的代码有问题（${reason}）。请重新输出完整的修改后 Manim 代码。`,
    `Your previous edited code was invalid (${reason}). Re-emit the complete edited Manim code.`
  ].join('\n\n')
}

function createCustomClient(config: CustomApiConfig): OpenAI {
  return createCustomOpenAIClient(config)
}

function applyPromptTemplate(
  template: string,
  values: Record<string, string>,
  promptOverrides?: PromptOverrides
): string {
  let output = template

  // 替换共享模块占位符
  output = output.replace(/\{\{apiIndexModule\}\}/g, getSharedModule('apiIndex', promptOverrides))
  output = output.replace(/\{\{sharedSpecification\}\}/g, getSharedModule('specification', promptOverrides))

  // 替换变量占位符
  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value || '')
  }
  return output
}

function extractCodeFromResponse(text: string, outputMode: OutputMode): string {
  if (!text) return ''
  const sanitized = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  if (outputMode === 'image') {
    return sanitized.trim()
  }
  const anchorMatch = sanitized.match(/### START ###([\s\S]*?)### END ###/)
  if (anchorMatch) {
    return anchorMatch[1].trim()
  }
  const codeMatch = sanitized.match(/```(?:python)?\n([\s\S]*?)```/i)
  if (codeMatch) {
    return codeMatch[1].trim()
  }
  return sanitized.trim()
}

export async function generateEditedManimCode(
  concept: string,
  instructions: string,
  code: string,
  outputMode: OutputMode,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides
): Promise<string> {
  if (!customApiConfig) {
    throw new Error('No upstream AI is configured for this request')
  }
  const model = customApiConfig.model?.trim() || ''
  if (!model) {
    throw new Error('No model available')
  }
  const client = createCustomClient(customApiConfig)

  let lastError: Error | undefined
  try {
    const baseSystemPrompt = getRoleSystemPrompt('codeEdit', promptOverrides)
    const userPromptOverride = promptOverrides?.roles?.codeEdit?.user
    const baseUserPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, instructions, code, outputMode }, promptOverrides)
      : generateCodeEditPrompt(concept, instructions, code, outputMode)
    const systemPrompt = baseSystemPrompt
    const userPrompt = baseUserPrompt

    logger.info('开始 AI 修改代码', { concept, outputMode })

    // Content retry: let AI re-emit on malformed output (max 2 attempts)
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
    const queueContentRepair = (contentAttempt: number, content: string, reason: string): boolean => {
      if (contentAttempt >= MAX_CONTENT_ATTEMPTS) return false
      if (content.trim()) messages.push({ role: 'assistant', content })
      messages.push({ role: 'user', content: repairInstruction(reason) })
      return true
    }

    for (let contentAttempt = 1; contentAttempt <= MAX_CONTENT_ATTEMPTS; contentAttempt += 1) {
      const { content, mode } = await createChatCompletionText(
        client,
        {
          model,
          messages,
          temperature: CODER_TEMPERATURE,
          ...buildCompletionParams(MAX_TOKENS, undefined, client)
        },
        {
          fallbackToNonStream: true,
          usageLabel: contentAttempt === 1 ? 'code-edit' : 'code-edit-repair'
        }
      )

      if (!content) {
        logger.warn('AI 修改返回空内容', { concept, contentAttempt })
        const reason = 'AI edit returned empty content'
        lastError = new Error(reason)
        logger.warn('AI 修改输出未通过内容检查', { concept, contentAttempt, reason })
        if (!queueContentRepair(contentAttempt, content, reason)) break
        continue
      }

      const extracted = extractCodeFromResponse(content, outputMode)
      if (!extracted.trim()) {
        const reason = 'AI edit produced empty code after extraction'
        lastError = new Error(reason)
        logger.warn('AI 修改输出未通过内容检查', { concept, contentAttempt, reason })
        if (!queueContentRepair(contentAttempt, content, reason)) break
        continue
      }

      logger.info('AI 修改完成', {
        concept,
        outputMode,
        mode,
        contentAttempt,
        length: extracted.length,
        codePreview: extracted.slice(0, 500)
      })
      return extracted
    }
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error))
    if (error instanceof OpenAI.APIError) {
      logger.error('AI 修改 API 错误', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message
      })
    } else if (error instanceof Error) {
      logger.error('AI 修改失败', { concept, errorName: error.name, errorMessage: error.message })
    } else {
      logger.error('AI 修改失败，未知错误', { concept, error: String(error) })
    }
  }

  logger.warn('AI 修改最终失败', {
    concept,
    attempts: MAX_CONTENT_ATTEMPTS,
    reason: lastError?.message
  })
  return ''
}

export function isCodeEditAvailable(): boolean {
  return true
}
