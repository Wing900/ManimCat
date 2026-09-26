import type { ManimApiProvider, ManimApiResult } from '../../services/manim-api'
import type { StudioKnowledgeProvider, StudioKnowledgeRequest, StudioKnowledgeResult } from './studio-knowledge-types'
import { formatStudioKnowledgeUnavailableContent } from './unavailable-studio-knowledge-provider'

export const MANIM_KNOWLEDGE_SOURCE = 'manim-runtime-catalog'

/**
 * Maps the existing Manim Runtime Catalog provider onto the generic Knowledge port.
 * Catalog generation, query tree, fuzzy search, cache and symbol formatting all stay
 * in src/services/manim-api.
 */
export class ManimKnowledgeAdapter implements StudioKnowledgeProvider {
  constructor(private readonly provider: ManimApiProvider) {}

  async lookup(request: StudioKnowledgeRequest): Promise<StudioKnowledgeResult> {
    const result = await this.provider.lookup({
      query: request.query,
      symbols: request.symbols
    })

    return mapManimApiResult(result, request)
  }
}

function mapManimApiResult(result: ManimApiResult, request: StudioKnowledgeRequest): StudioKnowledgeResult {
  return {
    status: result.status,
    source: MANIM_KNOWLEDGE_SOURCE,
    query: request.query,
    symbols: request.symbols,
    content: result.status === 'unavailable'
      // The catalog provider embeds the raw failure text; replace it with a safe message.
      ? formatStudioKnowledgeUnavailableContent('The Manim runtime catalog could not be queried.')
      : result.content,
    cached: result.cached,
    // The catalog provider does not report truncation; the lookup boundary owns it.
    truncated: false
  }
}
