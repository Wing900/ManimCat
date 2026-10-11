import type { ApiCatalogPackage, ApiRagService } from '../../knowledge/api-rag'
import type { StudioKind, StudioToolDefinition, StudioToolResult } from '../domain/types'
import { searchApiToolParameters } from './tool-parameters'

export const SEARCH_API_TOOL_NAME = 'search_api'

export interface SearchApiToolInput {
  query?: string
  symbols?: string[]
}

export interface SearchApiToolDependencies {
  service: ApiRagService
  packageName: ApiCatalogPackage
  studioKind: StudioKind
}

/**
 * The Builder's only API tool. `query` is a `verb + object + context` sentence that
 * recalls SearchDoc entries; `symbols` are names the Builder wants verified against the
 * Baseline. The result is structured JSON, never prose.
 */
export function createStudioSearchApiTool(
  dependencies: SearchApiToolDependencies
): StudioToolDefinition<SearchApiToolInput> {
  const { service, packageName, studioKind } = dependencies

  return {
    name: SEARCH_API_TOOL_NAME,
    parameters: searchApiToolParameters,
    description:
      'Search the verified API catalog before writing code that calls it. Write `query` as one ' +
      '`verb + object + context` sentence — the exact form the catalog is authored in, such as ' +
      '"draw a circle centered at the origin" or "plot a bar chart from values". A bare noun ' +
      'recalls almost nothing. Name every API you intend to call in `symbols`, as `Class.member` ' +
      'when you mean a member: a bare member name is not a symbol. Rows after the third describe ' +
      'an API in one line, as rank, symbol, kind and score; when you need the signature, the doc ' +
      'or the owner of one of those, call search_api again with that symbol alone in `symbols`, ' +
      'which skips the search and returns it in full. A NOT_FOUND verdict that lists ' +
      '`suggestions` means the name exists under another class: use the class it names. Never ' +
      'call an API the result does not name, and pick from the APIs an ambiguous name lists.',
    allowedAgents: ['builder'],
    allowedStudioKinds: [studioKind],
    execute: async (input) => {
      const query = input?.query?.trim() ?? ''
      const symbols = (input?.symbols ?? []).map((symbol) => symbol.trim()).filter(Boolean)
      if (!query && symbols.length === 0) {
        throw new Error('search_api requires a query, symbols, or both')
      }

      const result = await service.search(packageName, {
        query: query || undefined,
        symbols
      })
      const found = result.verification.filter((entry) => entry.verdict === 'FOUND').length
      const ambiguous = result.verification.filter((entry) => entry.verdict === 'AMBIGUOUS').length

      return {
        title: `API search: ${studioKind}`,
        output: JSON.stringify(result, null, 2),
        metadata: {
          packageName: result.packageName,
          packageVersion: result.packageVersion,
          mode: result.mode,
          query: result.query,
          verified: found,
          ambiguous,
          notFound: result.verification.length - found - ambiguous,
          candidates: result.candidates.length
        }
      } satisfies StudioToolResult
    }
  }
}
