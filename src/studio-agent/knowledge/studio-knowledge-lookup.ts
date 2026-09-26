import { createUnavailableStudioKnowledgeResult } from './unavailable-studio-knowledge-provider'
import { normalizeStudioKnowledgeRequest } from './studio-knowledge-request'
import type {
  StudioKnowledgeProvider,
  StudioKnowledgeRequest,
  StudioKnowledgeResult,
  StudioKnowledgeStatus
} from './studio-knowledge-types'

export const STUDIO_KNOWLEDGE_LOOKUP_SOURCE = 'studio-knowledge-lookup'

const STUDIO_KNOWLEDGE_STATUSES: readonly StudioKnowledgeStatus[] = ['found', 'not_found', 'unavailable']
const STUDIO_KNOWLEDGE_SOURCE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/

/**
 * The single safe lookup boundary. Normalizes the request, rejects empty lookups,
 * catches adapter failures, sanitizes every unavailable/invalid answer, and bounds
 * returned content so callers never observe raw errors or unbounded text.
 */
export async function lookupStudioKnowledge(
  provider: StudioKnowledgeProvider,
  request: StudioKnowledgeRequest
): Promise<StudioKnowledgeResult> {
  const normalized = normalizeStudioKnowledgeRequest(request)

  if (!normalized.query && normalized.symbols.length === 0) {
    // Runtime defense for whitespace-only or direct Tool invocation; schema is unchanged.
    return createUnavailableStudioKnowledgeResult(normalized, {
      source: STUDIO_KNOWLEDGE_LOOKUP_SOURCE,
      reason: 'The lookup request was empty after normalization.'
    })
  }

  try {
    const result = await provider.lookup(normalized)
    return finalizeStudioKnowledgeResult(result, normalized)
  } catch {
    // Knowledge lookup is advisory: failure becomes a structured result, never a throw.
    return createUnavailableStudioKnowledgeResult(normalized, {
      source: STUDIO_KNOWLEDGE_LOOKUP_SOURCE,
      reason: 'The knowledge provider failed to answer this lookup.'
    })
  }
}

function finalizeStudioKnowledgeResult(
  result: StudioKnowledgeResult,
  request: StudioKnowledgeRequest
): StudioKnowledgeResult {
  const source = sanitizeStudioKnowledgeSource(result.source)
  const status = STUDIO_KNOWLEDGE_STATUSES.includes(result.status) ? result.status : 'unavailable'

  if (status === 'unavailable') {
    // Provider content is never passed through for an unavailable/invalid answer.
    return createUnavailableStudioKnowledgeResult(request, {
      source,
      reason: 'The knowledge provider reported an unavailable lookup.'
    })
  }

  const raw = typeof result.content === 'string' ? result.content.trim() : ''
  if (!raw) {
    // Never downgrade an empty answer into a silent empty string, and never claim "found".
    return createUnavailableStudioKnowledgeResult(request, {
      source,
      reason: 'The knowledge provider returned no content.'
    })
  }

  return {
    status,
    source,
    query: request.query,
    symbols: request.symbols,
    content: raw.slice(0, request.maxChars),
    cached: result.cached === true,
    // Truncation truth is recorded where truncation happens: this boundary.
    truncated: result.truncated === true || raw.length > request.maxChars
  }
}

function sanitizeStudioKnowledgeSource(value: unknown): string {
  return typeof value === 'string' && STUDIO_KNOWLEDGE_SOURCE_PATTERN.test(value.trim())
    ? value.trim()
    : STUDIO_KNOWLEDGE_LOOKUP_SOURCE
}
