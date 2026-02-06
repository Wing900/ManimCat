/**
 * Code Retry Service - 绫诲瀷瀹氫箟
 */

import type { CustomApiConfig, PromptOverrides } from '../../types'

/**
 * 瀵硅瘽娑堟伅绫诲瀷
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 浠ｇ爜閲嶈瘯涓婁笅鏂?
 * 缁存姢瀹屾暣鐨勫璇濆巻鍙?
 */
export interface CodeRetryContext {
  concept: string
  sceneDesign: string
  originalPrompt: string
  messages: ChatMessage[]
  promptOverrides?: PromptOverrides
}

/**
 * 浠ｇ爜閲嶈瘯閫夐」
 */
export interface CodeRetryOptions {
  context: CodeRetryContext
  customApiConfig?: CustomApiConfig
}

/**
 * 浠ｇ爜閲嶈瘯缁撴灉
 */
export interface CodeRetryResult {
  success: boolean
  code: string
  attempt: number
  reason?: string
}

/**
 * 娓叉煋缁撴灉
 */
export interface RenderResult {
  success: boolean
  stderr: string
  stdout: string
  peakMemoryMB: number
}

/**
 * 閲嶈瘯绠＄悊鍣ㄧ粨鏋?
 */
export interface RetryManagerResult {
  code: string
  success: boolean
  attempts: number
  generationTimeMs?: number
  lastError?: string
}
