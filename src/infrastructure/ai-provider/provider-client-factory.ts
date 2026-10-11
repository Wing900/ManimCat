/**
 * AI Provider Client Factory
 *
 * Creates an OpenAI-compatible client from a CustomApiConfig.
 * The client is a standard `openai` SDK instance so callers can use
 * `client.chat.completions.create()` and `client.models.list()`.
 */

import OpenAI from 'openai'
import type { CustomApiConfig } from '../../types'
import { ValidationError } from '../../shared/errors/errors'

export function createCustomOpenAIClient(config: CustomApiConfig): OpenAI {
  return new OpenAI({
    baseURL: config.apiUrl,
    apiKey: config.apiKey,
  })
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const REDIRECT_PROBE_TIMEOUT_MS = 5_000

/**
 * Refuses a Base URL that only redirects, and names where it points.
 *
 * `fetch` is required by spec to re-issue a redirected POST as a GET (301/302), so a provider whose
 * address redirects answers `405 Method Not Allowed` — a complaint about the method, when the real
 * mistake is the address (`api.ollama.com` → `ollama.com`, an `http://` base that upgrades, a bare
 * host that gains `www`). Following the redirect instead is worse: the caller's `Authorization`
 * header travels to an origin they never named.
 *
 * So the redirect is reported as itself, before the SDK is ever handed the URL. A host that cannot
 * be reached at all is left alone — that is the real request's news to deliver.
 */
export async function assertBaseUrlIsFinal(apiUrl: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REDIRECT_PROBE_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(apiUrl, { method: 'GET', redirect: 'manual', signal: controller.signal })
  } catch {
    return
  } finally {
    clearTimeout(timer)
  }

  if (!REDIRECT_STATUSES.has(response.status)) {
    return
  }

  const target = response.headers.get('location')
  throw new ValidationError(
    target
      ? `上游地址发生了重定向（${response.status} → ${target}）。请把 Base URL 直接写成最终地址。`
      : `上游地址发生了重定向（${response.status}）。请把 Base URL 直接写成最终地址。`
  )
}
