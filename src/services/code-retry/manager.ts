/**
 * Code Retry Service - 重试管理器
 *
 * 核心逻辑：
 * 1. 维护完整的对话历史（原始提示词 + 每次生成的代码 + 每次的错误）
 * 2. 每次重试都发送完整的对话历史
 * 3. 最多重试 4 次
 */

import { createLogger } from '../../utils/logger'
import type { CodeRetryOptions, CodeRetryResult, RenderResult, RetryManagerResult, ChatMessage, CodeRetryContext } from './types'
import type { OutputMode, PromptOverrides } from '../../types'
import { extractErrorMessage, getErrorType } from './utils'
import { buildContextOriginalPrompt, buildRetryFixPrompt } from './prompt-builder'
import { generateInitialCode, retryCodeGeneration } from './code-generation'

const logger = createLogger('CodeRetryManager')

// 配置
const MAX_RETRIES = parseInt(process.env.CODE_RETRY_MAX_RETRIES || '4', 10)
/**
 * 创建重试上下文
 */
export function createRetryContext(
  concept: string,
  sceneDesign: string,
  promptOverrides?: PromptOverrides,
  outputMode: OutputMode = 'video'
): CodeRetryContext {
  return {
    concept,
    sceneDesign,
    outputMode,
    originalPrompt: buildContextOriginalPrompt(concept, sceneDesign, outputMode, promptOverrides),
    messages: [],
    promptOverrides
  }
}

/**
 * 构建重试提示词
 */
export { buildRetryFixPrompt } from './prompt-builder'

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
  customApiConfig?: any,
  initialCode?: string
): Promise<RetryManagerResult> {
  logger.info('开始代码重试管理', {
    concept: context.concept,
    maxRetries: MAX_RETRIES
  })

  // 步骤1：首次代码生成和渲染
  let generationTimeMs = 0
  let currentCode = initialCode?.trim() || ''
  if (!currentCode) {
    const generationStart = Date.now()
    currentCode = await generateInitialCode(context, customApiConfig)
    generationTimeMs += Date.now() - generationStart
  } else {
    // 对齐历史上下文，确保后续重试包含“原始提示词 + 首次代码”
    context.messages.push(
      { role: 'user', content: context.originalPrompt },
      { role: 'assistant', content: currentCode }
    )
  }
  let renderResult = await renderer(currentCode)

  if (renderResult.success) {
    logger.info('首次渲染成功')
    return { code: currentCode, success: true, attempts: 1, generationTimeMs }
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
      const generationStart = Date.now()
      currentCode = await retryCodeGeneration(context, errorMessage, attempt, customApiConfig)
      generationTimeMs += Date.now() - generationStart
      renderResult = await renderer(currentCode)

      if (renderResult.success) {
        logger.info('重试渲染成功', { attempt: attempt + 1 })
        return { code: currentCode, success: true, attempts: attempt + 1, generationTimeMs }
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
    generationTimeMs,
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
