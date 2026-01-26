/**
 * Code Retry Service - OpenAI 客户端管理
 */

import OpenAI from 'openai'
import type { CustomApiConfig } from '../../types'

const OPENAI_TIMEOUT = parseInt(process.env.OPENAI_TIMEOUT || '600000', 10)
const CUSTOM_API_URL = process.env.CUSTOM_API_URL?.trim()

// 默认客户端
let defaultClient: OpenAI | null = null

try {
  const baseConfig = {
    timeout: OPENAI_TIMEOUT,
    defaultHeaders: {
      'User-Agent': 'ManimCat/1.0'
    }
  }

  if (CUSTOM_API_URL) {
    defaultClient = new OpenAI({
      ...baseConfig,
      baseURL: CUSTOM_API_URL,
      apiKey: process.env.OPENAI_API_KEY
    })
  } else {
    defaultClient = new OpenAI(baseConfig)
  }
} catch (error) {
  console.warn('[CodeRetry] OpenAI 客户端初始化失败', error)
}

/**
 * 获取 OpenAI 客户端
 */
export function getClient(customApiConfig?: CustomApiConfig): OpenAI | null {
  if (customApiConfig) {
    return new OpenAI({
      baseURL: customApiConfig.apiUrl.trim().replace(/\/+$/, ''),
      apiKey: customApiConfig.apiKey,
      timeout: OPENAI_TIMEOUT,
      defaultHeaders: {
        'User-Agent': 'ManimCat/1.0'
      }
    })
  }
  return defaultClient
}

/**
 * 检查客户端是否可用
 */
export function isClientAvailable(): boolean {
  return defaultClient !== null
}
