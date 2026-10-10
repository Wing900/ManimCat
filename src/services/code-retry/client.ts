/**
 * Code Retry Service - OpenAI 客户端管理
 */

import OpenAI from 'openai'
import type { CustomApiConfig } from '../../types'
import { createCustomOpenAIClient } from '../../infrastructure/ai-provider/provider-client-factory'

/**
 * 获取 OpenAI 客户端
 */
export function getClient(customApiConfig?: CustomApiConfig): OpenAI | null {
  if (customApiConfig) {
    return createCustomOpenAIClient(customApiConfig)
  }
  return null
}

/**
 * 检查客户端是否可用
 */
export function isClientAvailable(): boolean {
  return true
}
