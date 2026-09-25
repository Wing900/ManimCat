import type { CodeRetryAction } from './types'
import { parsePatchResponse } from './utils'

const API_REQUEST_START = '[[API_REQUEST]]'
const ACTION_END = '[[END]]'

function parseApiRequestBody(body: string): { query: string; symbols: string[] } {
  try {
    const parsed = JSON.parse(body) as { query?: unknown; symbols?: unknown }
    const query = typeof parsed.query === 'string' ? parsed.query.trim() : ''
    const symbols = Array.isArray(parsed.symbols)
      ? parsed.symbols.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
      : []

    if (!query) {
      throw new Error('API request JSON requires a non-empty query')
    }
    return { query, symbols }
  } catch (error) {
    if (error instanceof SyntaxError) {
      const query = body.trim()
      if (query) {
        return { query, symbols: [] }
      }
    }
    throw error
  }
}

export function parseCodeRetryAction(text: string): CodeRetryAction {
  const normalized = text.trim()
  const apiStart = normalized.indexOf(API_REQUEST_START)
  const patchStart = normalized.indexOf('[[PATCH]]')

  if (apiStart >= 0 && patchStart >= 0) {
    throw new Error('Code retry response must contain exactly one action')
  }

  if (apiStart >= 0) {
    const end = normalized.indexOf(ACTION_END, apiStart + API_REQUEST_START.length)
    if (end < 0) {
      throw new Error('Code retry API request missing [[END]] marker')
    }
    const body = normalized.slice(apiStart + API_REQUEST_START.length, end).trim()
    return { type: 'api-request', request: parseApiRequestBody(body) }
  }

  return { type: 'patch', patchSet: parsePatchResponse(normalized) }
}
