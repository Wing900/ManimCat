/**
 * AI Provider Connection Probe
 *
 * Sends a minimal chat completion to verify that a provider endpoint
 * is reachable and the API key is valid.
 */

import type { CustomApiConfig } from '../../types'
import { assertBaseUrlIsFinal, createCustomOpenAIClient } from './provider-client-factory'

export interface ConnectionProbeResult {
  model: string
  content: string
}

export async function testBackendAIConnection(config: CustomApiConfig): Promise<ConnectionProbeResult> {
  // 先问一句地址本身是不是只转发。跟着重定向走，POST 会被降级成 GET，最后报出与病因无关的 405。
  await assertBaseUrlIsFinal(config.apiUrl)

  const client = createCustomOpenAIClient(config)
  const model = config.model

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 16,
  })

  const content = completion.choices[0]?.message?.content ?? ''
  return { model, content }
}
