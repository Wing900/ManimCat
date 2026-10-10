/**
 * AI Provider Client Factory
 *
 * Creates an OpenAI-compatible client from a CustomApiConfig.
 * The client is a standard `openai` SDK instance so callers can use
 * `client.chat.completions.create()` and `client.models.list()`.
 */

import OpenAI from 'openai'
import type { CustomApiConfig } from '../../types'

export function createCustomOpenAIClient(config: CustomApiConfig): OpenAI {
  return new OpenAI({
    baseURL: config.apiUrl,
    apiKey: config.apiKey,
  })
}
