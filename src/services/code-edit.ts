import OpenAI from 'openai'
import { createLogger } from '../utils/logger'
import { SYSTEM_PROMPTS, generateCodeEditPrompt, getSharedModule } from '../prompts'
import type { CustomApiConfig, OutputMode, PromptOverrides } from '../types'
import {
  createCustomOpenAIClient,
  initializeDefaultOpenAIClient
} from './openai-client-factory'

const logger = createLogger('CodeEditService')

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'glm-4-flash'
const CODER_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)
const openaiClient: OpenAI | null = initializeDefaultOpenAIClient((error) => {
  logger.warn('OpenAI 客户端初始化失败', { error })
})

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
  output = output.replace(/\{\{knowledge\}\}/g, getSharedModule('knowledge', promptOverrides))
  output = output.replace(/\{\{rules\}\}/g, getSharedModule('rules', promptOverrides))

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
  const client = customApiConfig ? createCustomClient(customApiConfig) : openaiClient

  if (!client) {
    logger.warn('OpenAI 客户端不可用')
    return ''
  }

  try {
    const baseSystemPrompt = promptOverrides?.roles?.codeEdit?.system || SYSTEM_PROMPTS.codeEdit
    const userPromptOverride = promptOverrides?.roles?.codeEdit?.user
    const baseUserPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, instructions, code, outputMode }, promptOverrides)
      : generateCodeEditPrompt(concept, instructions, code, outputMode)
    const systemPrompt = baseSystemPrompt
    const userPrompt = baseUserPrompt

    logger.info('开始 AI 修改代码', { concept, outputMode })

    const model = customApiConfig?.model?.trim() || OPENAI_MODEL

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: CODER_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      logger.warn('AI 修改返回空内容')
      return ''
    }

    const extracted = extractCodeFromResponse(content, outputMode)
    logger.info('AI 修改完成', { concept, outputMode, length: extracted.length })
    return extracted
  } catch (error) {
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
    return ''
  }
}

export function isCodeEditAvailable(): boolean {
  return openaiClient !== null
}

