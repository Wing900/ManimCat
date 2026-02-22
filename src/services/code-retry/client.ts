/**
 * Code Retry Service - OpenAI 客户端管理
 */

import OpenAI from 'openai'
import type { CustomApiConfig } from '../../types'
import {
  createCustomOpenAIClient,
  initializeDefaultOpenAIClient
} from '../openai-client-factory'

const defaultClient: OpenAI | null = initializeDefaultOpenAIClient((error) => {
  console.warn('[CodeRetry] OpenAI 客户端初始化失败', error)
})

/**
 * 获取 OpenAI 客户端
 */
export function getClient(customApiConfig?: CustomApiConfig): OpenAI | null {
  if (customApiConfig) {
    return createCustomOpenAIClient(customApiConfig)
  }
  return defaultClient
}

/**
 * 检查客户端是否可用
 */
export function isClientAvailable(): boolean {
  return defaultClient !== null
}
