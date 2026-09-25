import { createLogger } from '../../utils/logger'
import { ManimApiQueryTree, type QueryMatch } from './query-tree'
import { loadRuntimeManimCatalog } from './runtime-catalog'
import type { ManimApiProvider, ManimApiRequest, ManimApiResult } from './types'

const logger = createLogger('RuntimeManimApiProvider')

function formatMatch(match: QueryMatch): string {
  if (match.type === 'symbol') {
    const symbol = match.symbol
    const lines = [
      `[${match.confidence}] ${symbol.kind} ${symbol.path}${symbol.signature || ''}`
    ]
    if (symbol.aliases.length > 0) {
      lines.push(`Aliases: ${symbol.aliases.slice(0, 8).join(', ')}`)
    }
    if (symbol.mro) {
      lines.push(`MRO: ${symbol.mro.join(' -> ')}`)
    }
    if (symbol.doc) {
      lines.push(`Doc: ${symbol.doc.slice(0, 360)}`)
    }
    return lines.join('\n')
  }

  const member = match.member
  return [
    `[${match.confidence}] ${member.kind} ${match.classSymbol.name}.${match.memberName}${member.signature || ''}`,
    `Owner: ${member.owner}`,
    member.doc ? `Doc: ${member.doc.slice(0, 360)}` : ''
  ].filter(Boolean).join('\n')
}

export class RuntimeManimApiProvider implements ManimApiProvider {
  private readonly cache = new Map<string, ManimApiResult>()

  async lookup(request: ManimApiRequest): Promise<ManimApiResult> {
    const cacheKey = JSON.stringify({
      query: request.query.trim().toLowerCase(),
      symbols: request.symbols.map((symbol) => symbol.trim().toLowerCase()).sort()
    })
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return { ...cached, cached: true }
    }

    try {
      const catalog = await loadRuntimeManimCatalog()
      const matches = new ManimApiQueryTree(catalog).query(request)
      const status = matches.length > 0 ? 'found' : 'not_found'
      const content = [
        `Status: ${status.toUpperCase()}`,
        `Runtime: ManimCE ${catalog.manimVersion} / Python ${catalog.pythonVersion}`,
        `Query: ${request.query}`,
        `Symbols: ${request.symbols.join(', ') || '(none)'}`,
        matches.length > 0
          ? `Matches:\n${matches.map(formatMatch).join('\n\n')}`
          : 'No matching runtime symbol or member was found. Do not invent an API; request another symbol or use a verified simpler API.'
      ].join('\n\n')
      const result: ManimApiResult = {
        status,
        query: request.query,
        symbols: request.symbols,
        content,
        cached: false
      }
      this.cache.set(cacheKey, result)
      return result
    } catch (error) {
      logger.error('Manim runtime API lookup failed', { error: String(error) })
      return {
        status: 'unavailable',
        query: request.query,
        symbols: request.symbols,
        content: `Status: UNAVAILABLE\nRuntime catalog could not be loaded: ${String(error)}\nDo not invent an API.`,
        cached: false
      }
    }
  }
}
