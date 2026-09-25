import type {
  ManimApiRequest,
  RuntimeManimCatalog,
  RuntimeMemberRecord,
  RuntimeSymbolRecord
} from './types'

export type QueryMatch =
  | {
      type: 'symbol'
      confidence: 'exact' | 'search' | 'fuzzy'
      symbol: RuntimeSymbolRecord
    }
  | {
      type: 'member'
      confidence: 'exact' | 'inherited' | 'search' | 'fuzzy'
      classSymbol: RuntimeSymbolRecord
      memberName: string
      member: RuntimeMemberRecord
    }

const STOP_WORDS = new Set([
  'about', 'api', 'does', 'from', 'have', 'how', 'know', 'manim', 'need', 'should',
  'that', 'this', 'usage', 'use', 'what', 'when', 'where', 'which', 'with', 'would'
])

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function levenshtein(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j]
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      diagonal = old
    }
  }
  return previous[b.length]
}

function nameTokens(value: string): Set<string> {
  return new Set(normalize(value).split(/[^a-z0-9]+/).filter(Boolean))
}

function fuzzyScore(target: string, candidate: string): number {
  const targetTokens = nameTokens(target)
  const candidateTokens = nameTokens(candidate)
  const overlap = [...targetTokens].filter((token) => candidateTokens.has(token)).length
  const overlapRatio = targetTokens.size > 0 ? overlap / targetTokens.size : 0
  return levenshtein(target, candidate) / Math.max(target.length, candidate.length, 1) - overlapRatio
}

export class ManimApiQueryTree {
  private readonly pathIndex = new Map<string, string>()
  private readonly shortNameIndex = new Map<string, string[]>()

  constructor(private readonly catalog: RuntimeManimCatalog) {
    for (const [alias, canonical] of Object.entries(catalog.aliasIndex)) {
      this.pathIndex.set(normalize(alias), canonical)
    }
    for (const [canonical, symbol] of Object.entries(catalog.symbols)) {
      this.pathIndex.set(normalize(canonical), canonical)
      const shortName = normalize(symbol.name)
      const current = this.shortNameIndex.get(shortName) || []
      current.push(canonical)
      this.shortNameIndex.set(shortName, current)
    }
  }

  private resolveSymbol(reference: string): RuntimeSymbolRecord | undefined {
    const clean = reference.trim().replace(/\(.*$/, '')
    const direct = this.pathIndex.get(normalize(clean)) || this.pathIndex.get(normalize(`manim.${clean}`))
    if (direct) {
      return this.catalog.symbols[direct]
    }
    const shortMatches = this.shortNameIndex.get(normalize(clean)) || []
    if (shortMatches.length === 1) {
      return this.catalog.symbols[shortMatches[0]]
    }
    const topLevel = shortMatches.find((path) => path.startsWith('manim.') && path.split('.').length === 2)
    return topLevel ? this.catalog.symbols[topLevel] : undefined
  }

  private resolveClassMember(classSymbol: RuntimeSymbolRecord, memberName: string): QueryMatch | undefined {
    if (classSymbol.kind !== 'class') {
      return undefined
    }
    const ownMember = classSymbol.members?.[memberName]
    if (ownMember) {
      return { type: 'member', confidence: 'exact', classSymbol, memberName, member: ownMember }
    }

    for (const ownerPath of classSymbol.mro?.slice(1) || []) {
      const owner = this.resolveSymbol(ownerPath)
      const inherited = owner?.members?.[memberName]
      if (inherited) {
        return { type: 'member', confidence: 'inherited', classSymbol, memberName, member: inherited }
      }
    }
    return undefined
  }

  private splitMemberReference(reference: string): { owner: RuntimeSymbolRecord; member: string } | undefined {
    const parts = reference.trim().replace(/\(.*$/, '').split('.')
    for (let split = parts.length - 1; split > 0; split -= 1) {
      const owner = this.resolveSymbol(parts.slice(0, split).join('.'))
      if (owner?.kind === 'class') {
        return { owner, member: parts.slice(split).join('.') }
      }
    }
    return undefined
  }

  private exact(reference: string): QueryMatch | undefined {
    const symbol = this.resolveSymbol(reference)
    if (symbol) {
      return { type: 'symbol', confidence: 'exact', symbol }
    }
    const split = this.splitMemberReference(reference)
    return split ? this.resolveClassMember(split.owner, split.member) : undefined
  }

  private fuzzy(reference: string): QueryMatch[] {
    const split = this.splitMemberReference(reference)
    if (split) {
      const candidates = new Map<string, RuntimeMemberRecord>()
      for (const ownerPath of split.owner.mro || [split.owner.path]) {
        const owner = this.resolveSymbol(ownerPath)
        for (const [name, member] of Object.entries(owner?.members || {})) {
          if (!candidates.has(name)) {
            candidates.set(name, member)
          }
        }
      }
      return [...candidates.entries()]
        .map(([memberName, member]) => ({
          score: fuzzyScore(split.member, memberName),
          match: {
            type: 'member' as const,
            confidence: 'fuzzy' as const,
            classSymbol: split.owner,
            memberName,
            member
          }
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 6)
        .map(({ match }) => match)
    }

    const target = reference.trim().split('.').at(-1) || reference
    return Object.values(this.catalog.symbols)
      .map((symbol) => ({ score: fuzzyScore(target, symbol.name), symbol }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 6)
      .map(({ symbol }) => ({ type: 'symbol', confidence: 'fuzzy', symbol }))
  }

  private search(query: string): QueryMatch[] {
    const terms = (query.match(/[A-Za-z_][A-Za-z0-9_.]*/g) || [])
      .map(normalize)
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
    if (terms.length === 0) {
      return []
    }

    const symbolMatches: Array<{ score: number; match: QueryMatch }> = Object.values(this.catalog.symbols)
      .map((symbol): { score: number; match: QueryMatch } => {
        const haystack = normalize(`${symbol.path} ${symbol.doc || ''}`)
        return {
          score: terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0),
          match: { type: 'symbol', confidence: 'search', symbol }
        }
      })

    const memberMatches: Array<{ score: number; match: QueryMatch }> = []
    for (const classSymbol of Object.values(this.catalog.symbols)) {
      if (classSymbol.kind !== 'class') {
        continue
      }
      for (const [memberName, member] of Object.entries(classSymbol.members || {})) {
        const haystack = normalize(`${classSymbol.name}.${memberName} ${member.doc || ''}`)
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0)
        if (score > 0) {
          memberMatches.push({
            score,
            match: { type: 'member', confidence: 'search', classSymbol, memberName, member }
          })
        }
      }
    }

    return [...symbolMatches, ...memberMatches]
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ match }) => match)
  }

  query(request: ManimApiRequest): QueryMatch[] {
    const matches: QueryMatch[] = []
    const seen = new Set<string>()
    const add = (match: QueryMatch): void => {
      const key = match.type === 'symbol'
        ? `symbol:${match.symbol.path}`
        : `member:${match.classSymbol.path}.${match.memberName}`
      if (!seen.has(key)) {
        seen.add(key)
        matches.push(match)
      }
    }

    for (const reference of request.symbols) {
      const exact = this.exact(reference)
      if (exact) {
        add(exact)
        if (exact.type === 'member' && !exact.member.signature) {
          this.fuzzy(reference).forEach(add)
        }
      } else {
        this.fuzzy(reference).forEach(add)
      }
    }
    if (request.symbols.length === 0) {
      this.search(request.query).forEach(add)
    }
    return matches.slice(0, 12)
  }
}
