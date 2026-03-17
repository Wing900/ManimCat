import OpenAI from 'openai'
import type { CustomApiConfig } from '../types'

const OPENAI_TIMEOUT = parseInt(process.env.OPENAI_TIMEOUT || '600000', 10)

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

export function createCustomOpenAIClient(config: CustomApiConfig): OpenAI {
  const apiUrl = (config.apiUrl || '').trim().replace(/\/+$/, '')
  const apiKey = (config.apiKey || '').trim()

  // Guardrail: if apiKey is missing, the OpenAI SDK may fall back to OPENAI_API_KEY env var.
  // We never want that behavior in this project: upstream must be explicitly configured per request/route.
  if (!apiUrl || !apiKey) {
    throw new Error('Upstream apiUrl/apiKey is missing')
  }

  return new OpenAI({
    ...createBaseConfig(),
    baseURL: apiUrl,
    apiKey
  })
}
