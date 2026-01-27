/**
 * Code Retry Service - 类型定义
 */

import type { CustomApiConfig, PromptOverrides } from '../../types'

/**
 * 对话消息类型
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 代码重试上下文
 * 维护完整的对话历史
 */
export interface CodeRetryContext {
  concept: string
  sceneDesign: string
  originalPrompt: string // 原始写代码的提示词
  messages: ChatMessage[] // 完整对话历史
}

/**
 * 代码重试选项
 */
export interface CodeRetryOptions {
  context: CodeRetryContext
  customApiConfig?: CustomApiConfig
}

/**
 * 代码重试结果
 */
export interface CodeRetryResult {
  success: boolean
  code: string
  attempt: number
  reason?: string
}

/**
 * 渲染结果
 */
export interface RenderResult {
  success: boolean
  stderr: string
  stdout: string
  peakMemoryMB: number
}

/**
 * 重试管理器结果
 */
export interface RetryManagerResult {
  code: string
  success: boolean
  attempts: number
  lastError?: string
}
