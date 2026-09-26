import type { StudioKnowledgeProvider, StudioKnowledgeRequest, StudioKnowledgeResult } from './studio-knowledge-types'

export const STUDIO_KNOWLEDGE_UNAVAILABLE_SOURCE = 'studio-knowledge-unavailable'

const DEFAULT_UNAVAILABLE_REASON = 'No knowledge adapter is available for this Studio runtime.'
const UNAVAILABLE_GUIDANCE = 'Do not invent an API; keep the implementation to verified runtime behavior.'

/**
 * Safe, bounded message for any unavailable lookup. Never includes error objects,
 * stack traces, environment values, credentials, or raw process output.
 */
export function formatStudioKnowledgeUnavailableContent(reason: string): string {
  return `Status: UNAVAILABLE\n${reason}\n${UNAVAILABLE_GUIDANCE}`
}

export function createUnavailableStudioKnowledgeResult(
  request: StudioKnowledgeRequest,
  options?: { source?: string; reason?: string }
): StudioKnowledgeResult {
  return {
    status: 'unavailable',
    source: options?.source ?? STUDIO_KNOWLEDGE_UNAVAILABLE_SOURCE,
    query: request.query,
    symbols: request.symbols,
    content: formatStudioKnowledgeUnavailableContent(options?.reason ?? DEFAULT_UNAVAILABLE_REASON),
    cached: false,
    truncated: false
  }
}

export function createUnavailableStudioKnowledgeProvider(options?: {
  source?: string
  reason?: string
}): StudioKnowledgeProvider {
  return {
    async lookup(request) {
      return createUnavailableStudioKnowledgeResult(request, options)
    }
  }
}
