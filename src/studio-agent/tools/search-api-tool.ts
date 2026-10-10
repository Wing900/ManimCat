import type { ApiCatalogPackage, ApiRagService } from '../../services/api-rag'
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
      'Search the verified API catalog before writing code that calls it. ' +
      'Never call an API the result does not name.',
    allowedAgents: ['builder'],
    allowedStudioKinds: [studioKind],
    execute: async (input) => {
      const query = input?.query?.trim() ?? ''
      if (!query) {
        throw new Error('search_api requires a non-empty query')
      }

      const result = await service.search(packageName, {
        query,
        symbols: input?.symbols ?? []
      })
      const found = result.verification.filter((entry) => entry.verdict === 'FOUND').length

      return {
        title: `API search: ${studioKind}`,
        output: JSON.stringify(result, null, 2),
        metadata: {
          packageName: result.packageName,
          packageVersion: result.packageVersion,
          query: result.query,
          verified: found,
          notFound: result.verification.length - found,
          candidates: result.candidates.length
        }
      } satisfies StudioToolResult
    }
  }
}
