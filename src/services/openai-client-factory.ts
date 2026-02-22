import OpenAI from 'openai'
import type { CustomApiConfig } from '../types'

const OPENAI_TIMEOUT = parseInt(process.env.OPENAI_TIMEOUT || '600000', 10)
const CUSTOM_API_URL = process.env.CUSTOM_API_URL?.trim()

interface OpenAIBaseConfig {
  timeout: number
  defaultHeaders: {
    'User-Agent': string
  }
}

function createBaseConfig(): OpenAIBaseConfig {
  return {
    timeout: OPENAI_TIMEOUT,
    defaultHeaders: {
      'User-Agent': 'ManimCat/1.0'
    }
  }
}

export function createDefaultOpenAIClient(): OpenAI {
  const baseConfig = createBaseConfig()
  if (CUSTOM_API_URL) {
    return new OpenAI({
      ...baseConfig,
      baseURL: CUSTOM_API_URL,
      apiKey: process.env.OPENAI_API_KEY
    })
  }
  return new OpenAI(baseConfig)
}

export function createCustomOpenAIClient(config: CustomApiConfig): OpenAI {
  return new OpenAI({
    ...createBaseConfig(),
    baseURL: config.apiUrl.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey
  })
}

export function initializeDefaultOpenAIClient(
  onError?: (error: unknown) => void
): OpenAI | null {
  try {
    return createDefaultOpenAIClient()
  } catch (error) {
    onError?.(error)
    return null
  }
}
