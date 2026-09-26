import type { StudioKnowledgeRequest } from './studio-knowledge-types'

export const STUDIO_KNOWLEDGE_LIMITS = {
  maxQueryChars: 500,
  maxSymbols: 12,
  maxSymbolChars: 160,
  minContentChars: 500,
  maxContentChars: 6000
} as const

/**
 * Single normalization point for Knowledge requests. Adapters and the lookup Tool
 * both observe the returned request, so bounds cannot diverge between them.
 */
export function normalizeStudioKnowledgeRequest(input: StudioKnowledgeRequest): StudioKnowledgeRequest {
  const query = String(input.query ?? '').trim().slice(0, STUDIO_KNOWLEDGE_LIMITS.maxQueryChars)
  const symbols = Array.isArray(input.symbols)
    ? input.symbols
      .slice(0, STUDIO_KNOWLEDGE_LIMITS.maxSymbols)
      .map((symbol) => String(symbol).trim().slice(0, STUDIO_KNOWLEDGE_LIMITS.maxSymbolChars))
      .filter((symbol) => symbol.length > 0)
    : []

  return {
    kind: input.kind,
    query,
    symbols,
    maxChars: clampStudioKnowledgeMaxChars(input.maxChars)
  }
}

function clampStudioKnowledgeMaxChars(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return STUDIO_KNOWLEDGE_LIMITS.maxContentChars
  }

  return Math.min(
    Math.max(Math.trunc(value), STUDIO_KNOWLEDGE_LIMITS.minContentChars),
    STUDIO_KNOWLEDGE_LIMITS.maxContentChars
  )
}
