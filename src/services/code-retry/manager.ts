/**
 * Code Retry Service - 重试管理器
 *
 * 核心逻辑：
 * 1. 维护完整的对话历史（原始提示词 + 每次生成的代码 + 每次的错误）
 * 2. 每次重试都发送完整的对话历史
 * 3. 最多重试 4 次
 */

import crypto from 'crypto'
import OpenAI from 'openai'
import { createLogger } from '../../utils/logger'
import { cleanManimCode } from '../../utils/manim-code-cleaner'

import type { CodeRetryOptions, CodeRetryResult, RenderResult, RetryManagerResult, ChatMessage, CodeRetryContext } from './types'
import type { PromptOverrides } from '../../types'
import { buildInitialCodePrompt, CODE_RETRY_SYSTEM_PROMPT } from './prompts'
import { getClient } from './client'
import { extractCodeFromResponse, extractErrorMessage, getErrorType } from './utils'

const logger = createLogger('CodeRetryManager')

// 配置
const MAX_RETRIES = parseInt(process.env.CODE_RETRY_MAX_RETRIES || '4', 10)
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'glm-4-flash'
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)

/**
 * 生成唯一种子
 */
function applyPromptTemplate(template: string, values: Record<string, string>): string {
  let output = template
  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`{{\s*${key}\s*}}`, 'g'), value)
  }
  return output
}

function getCodeRetrySystemPrompt(promptOverrides?: PromptOverrides): string {
  return promptOverrides?.system?.codeRetry || CODE_RETRY_SYSTEM_PROMPT
}

function buildInitialPrompt(
  concept: string,
  seed: string,
  sceneDesign: string,
  promptOverrides?: PromptOverrides
): string {
  const override = promptOverrides?.user?.codeRetryInitial
  if (override) {
    return applyPromptTemplate(override, {
      concept,
      seed,
      sceneDesign
    })
  }
  return buildInitialCodePrompt(concept, seed, sceneDesign)
}

function generateSeed(concept: string): string {
  const timestamp = Date.now()
  const randomPart = crypto.randomBytes(4).toString('hex')
  return crypto.createHash('md5').update(`${concept}-${timestamp}-${randomPart}`).digest('hex').slice(0, 8)
}

/**
 * 创建重试上下文
 */
export function createRetryContext(
  concept: string,
  sceneDesign: string,
  promptOverrides?: PromptOverrides
): CodeRetryContext {
  const seed = generateSeed(concept)

  return {
    concept,
    sceneDesign,
    originalPrompt: buildInitialPrompt(concept, seed, sceneDesign, promptOverrides),
    messages: [],
    promptOverrides
  }
}

/**
 * 首次代码生成
 */
async function generateInitialCode(
  context: CodeRetryContext,
  customApiConfig?: any
): Promise<string> {
  const client = getClient(customApiConfig)
  if (!client) {
    throw new Error('OpenAI 客户端不可用')
  }

  try {
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: getCodeRetrySystemPrompt(context.promptOverrides) },
        { role: 'user', content: context.originalPrompt }
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      throw new Error('AI 返回空内容')
    }

    // 清洗代码
    const code = extractCodeFromResponse(content)
    const cleaned = cleanManimCode(code)

    // 保存对话历史
    context.messages.push(
      { role: 'user', content: context.originalPrompt },
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

/**
 * 重试代码生成
 */
async function retryCodeGeneration(
  context: CodeRetryContext,
  errorMessage: string,
  attempt: number,
  customApiConfig?: any
): Promise<string> {
  const client = getClient(customApiConfig)
  if (!client) {
    throw new Error('OpenAI 客户端不可用')
  }

  // 构建重试提示词（包含完整对话历史和错误信息）
  const retryPrompt = buildRetryPrompt(context, errorMessage, attempt)

  try {
    // 构建消息数组：system + 历史消息 + 当前重试提示词
    const messages: ChatMessage[] = [
      { role: 'system', content: getCodeRetrySystemPrompt(context.promptOverrides) },
      ...context.messages,
      { role: 'user', content: retryPrompt }
    ]

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: AI_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      throw new Error('AI 返回空内容')
    }

    // 清洗代码
    const code = extractCodeFromResponse(content)
    const cleaned = cleanManimCode(code)

    // 保存对话历史
    context.messages.push(
      { role: 'user', content: retryPrompt },
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

/**
 * 构建重试提示词
 */
export function buildRetryFixPrompt(
  concept: string,
  errorMessage: string,
  attempt: number | string
): string {
  return `## 目标层

### 输入预期

- **概念**：${concept}
- **错误信息**（第 ${attempt} 次重试）：${errorMessage}

### 产出要求

- **修复代码**：根据错误信息修复之前的代码。
- **完整代码**：必须输出完整的、可运行的 Manim 代码，不是修复片段！
- **锚点协议**：代码必须包裹在 ### START ### 和 ### END ### 之间
- **纯代码输出**：严禁包含任何解释性文字。
- **结构规范**：核心类名固定为 \`AnimationScene\`
`
}

function buildRetryPrompt(
  context: CodeRetryContext,
  errorMessage: string,
  attempt: number
): string {
  const override = context.promptOverrides?.user?.codeRetryFix
  if (override) {
    return applyPromptTemplate(override, {
      concept: context.concept,
      errorMessage,
      attempt: String(attempt)
    })
  }
  return buildRetryFixPrompt(context.concept, errorMessage, attempt)
}

/**
 * 重试管理器 - 核心函数
 *
 * 流程：
 * 1. 首次生成代码 → 渲染
 * 2. 如果失败，检查错误是否可修复
 * 3. 重试（最多4次），每次都发送完整对话历史
 * 4. 如果4次后仍失败，返回失败结果
 */
export async function executeCodeRetry(
  context: CodeRetryContext,
  renderer: (code: string) => Promise<RenderResult>,
  customApiConfig?: any
): Promise<RetryManagerResult> {
  logger.info('开始代码重试管理', {
    concept: context.concept,
    maxRetries: MAX_RETRIES
  })

  // 步骤1：首次代码生成和渲染
  let currentCode = await generateInitialCode(context, customApiConfig)
  let renderResult = await renderer(currentCode)

  if (renderResult.success) {
    logger.info('首次渲染成功')
    return { code: currentCode, success: true, attempts: 1 }
  }

  // 步骤2：提取错误信息并开始重试
  let errorMessage = extractErrorMessage(renderResult.stderr)
  let errorType = getErrorType(renderResult.stderr)
  logger.warn('首次渲染失败', { errorType, error: errorMessage })
  // 所有错误都尝试重试，AI 有能力修复语法、导入等问题

  // 步骤3：重试循环
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info(`开始第 ${attempt} 次重试`, {
      totalAttempts: attempt + 1,
      errorType,
      error: errorMessage
    })

    try {
      currentCode = await retryCodeGeneration(context, errorMessage, attempt, customApiConfig)
      renderResult = await renderer(currentCode)

      if (renderResult.success) {
        logger.info('重试渲染成功', { attempt: attempt + 1 })
        return { code: currentCode, success: true, attempts: attempt + 1 }
      }

      // 更新错误信息
      errorMessage = extractErrorMessage(renderResult.stderr)
      errorType = getErrorType(renderResult.stderr)
      logger.warn('重试渲染失败', { attempt: attempt + 1, errorType, error: errorMessage })
    } catch (error) {
      logger.error('重试过程出错', { attempt: attempt + 1, error: String(error) })
    }
  }

  // 步骤4：所有重试失败
  logger.error('所有重试均失败', {
    totalAttempts: MAX_RETRIES + 1,
    finalError: extractErrorMessage(renderResult.stderr)
  })

  return {
    code: currentCode,
    success: false,
    attempts: MAX_RETRIES + 1,
    lastError: extractErrorMessage(renderResult.stderr)
  }
}

/**
 * 导出类型
 */
export type {
  CodeRetryOptions,
  CodeRetryResult,
  RenderResult,
  RetryManagerResult,
  ChatMessage,
  CodeRetryContext
} from './types'
