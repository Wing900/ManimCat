import { createUnavailableStudioKnowledgeResult } from '../unavailable-studio-knowledge-provider'
import type {
  StudioKnowledgeProvider,
  StudioKnowledgeRequest,
  StudioKnowledgeResult
} from '../studio-knowledge-types'
import { MatplotlibApiQueryTree, type MatplotlibQueryMatch } from './matplotlib-query-tree'
import type { PythonRuntimeCatalog } from './python-runtime-catalog-types'
import { loadRuntimeMatplotlibCatalog, type MatplotlibCatalogLoader } from './runtime-matplotlib-catalog'

export const MATPLOTLIB_KNOWLEDGE_SOURCE = 'matplotlib-runtime-catalog'

const DOC_EXCERPT_CHARS = 360
const MAX_ALIASES_SHOWN = 8

const NOT_FOUND_CONTENT = [
  'Status: NOT_FOUND',
  'No matching runtime symbol or member was found.',
  'Do not invent an API; request another symbol or use a verified simpler API.'
].join('\n')

/**
 * Matplotlib Knowledge adapter over the lazy Runtime Catalog. The catalog is loaded
 * on first lookup only, the Query Tree stays pure, and the 04A safe boundary remains
 * the authoritative layer for request normalization, sanitization and truncation.
 */
export class MatplotlibKnowledgeAdapter implements StudioKnowledgeProvider {
  private readonly loader: MatplotlibCatalogLoader
  private readonly resultCache = new Map<string, StudioKnowledgeResult>()
  private catalogPromise?: Promise<PythonRuntimeCatalog>

  constructor(loader: MatplotlibCatalogLoader = loadRuntimeMatplotlibCatalog) {
    this.loader = loader
  }

  async lookup(request: StudioKnowledgeRequest): Promise<StudioKnowledgeResult> {
    const cacheKey = JSON.stringify({
      query: request.query.toLowerCase(),
      symbols: request.symbols.map((symbol) => symbol.toLowerCase()).sort()
    })
    const cached = this.resultCache.get(cacheKey)
    if (cached) {
      return { ...cached, cached: true }
    }

    try {
      const catalog = await this.loadCatalog()
      const matches = new MatplotlibApiQueryTree(catalog).query({
        query: request.query,
        symbols: request.symbols
      })
      const result: StudioKnowledgeResult = {
        status: matches.length > 0 ? 'found' : 'not_found',
        source: MATPLOTLIB_KNOWLEDGE_SOURCE,
        query: request.query,
        symbols: request.symbols,
        content: matches.length > 0
          ? formatMatplotlibMatches(catalog, request, matches)
          : NOT_FOUND_CONTENT,
        cached: false,
        // The generic boundary records final truncation; the adapter never trims to fit.
        truncated: false
      }
      this.resultCache.set(cacheKey, result)
      return result
    } catch {
      return createUnavailableStudioKnowledgeResult(request, {
        source: MATPLOTLIB_KNOWLEDGE_SOURCE,
        reason: 'The matplotlib runtime catalog could not be queried.'
      })
    }
  }

  private loadCatalog(): Promise<PythonRuntimeCatalog> {
    if (!this.catalogPromise) {
      this.catalogPromise = this.loader().catch((error) => {
        // Clear the failed attempt so a later lookup can retry.
        this.catalogPromise = undefined
        throw error
      })
    }
    return this.catalogPromise
  }
}

function formatMatplotlibMatches(
  catalog: PythonRuntimeCatalog,
  request: StudioKnowledgeRequest,
  matches: MatplotlibQueryMatch[]
): string {
  const header = [
    'Status: FOUND',
    `Runtime: matplotlib ${catalog.packageVersion} / Python ${catalog.pythonVersion}`,
    `Query: ${request.query}`,
    `Symbols: ${request.symbols.join(', ') || '(none)'}`
  ]

  return [...header, `Matches:\n${matches.map(formatMatch).join('\n\n')}`].join('\n\n')
}

function formatMatch(match: MatplotlibQueryMatch): string {
  if (match.type === 'symbol') {
    const symbol = match.symbol
    const lines = [`[${match.confidence}] ${symbol.kind} ${symbol.path}${symbol.signature ?? ''}`]
    if (symbol.aliases.length > 0) {
      lines.push(`Aliases: ${symbol.aliases.slice(0, MAX_ALIASES_SHOWN).join(', ')}`)
    }
    if (symbol.mro && symbol.mro.length > 1) {
      lines.push(`MRO: ${symbol.mro.join(' -> ')}`)
    }
    if (symbol.value) {
      lines.push(`Value: ${symbol.value}`)
    }
    if (symbol.doc) {
      lines.push(`Doc: ${symbol.doc.slice(0, DOC_EXCERPT_CHARS)}`)
    }
    return lines.join('\n')
  }

  const member = match.member
  return [
    `[${match.confidence}] ${member.kind} ${match.classSymbol.path}.${match.memberName}${member.signature ?? ''}`,
    `Owner: ${member.owner}`,
    member.doc ? `Doc: ${member.doc.slice(0, DOC_EXCERPT_CHARS)}` : ''
  ].filter(Boolean).join('\n')
}
