import type {
  PythonRuntimeCatalog,
  PythonRuntimeMemberRecord,
  PythonRuntimeSymbolRecord,
} from './python-runtime-catalog-types'

export type MatplotlibQueryMatch =
  | {
    type: 'symbol'
    confidence: 'exact' | 'search' | 'fuzzy'
    symbol: PythonRuntimeSymbolRecord
  }
  | {
    type: 'member'
    confidence: 'exact' | 'inherited' | 'search' | 'fuzzy'
    classSymbol: PythonRuntimeSymbolRecord
    memberName: string
    member: PythonRuntimeMemberRecord
  }

const ROOT_PACKAGE = 'matplotlib'
const PACKAGE_ALIASES: Record<string, string> = {
  plt: 'matplotlib.pyplot',
  mpl: ROOT_PACKAGE,
}

const MAX_MATCHES = 12
const MAX_FUZZY_MATCHES = 6
// Reject distant candidates so misspelling help never turns into an invented API.
const MAX_FUZZY_SCORE = 0.5

const STOP_WORDS = new Set([
  'about', 'api', 'does', 'from', 'have', 'how', 'know', 'matplotlib', 'need', 'plot',
  'pyplot', 'should', 'that', 'this', 'usage', 'use', 'what', 'when', 'where', 'which',
  'with', 'would'
])

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Public query surface rule. The generator registers auxiliary private bases such as
 * `matplotlib.axes._AxesBase` so inherited members of public classes stay resolvable
 * through the MRO; those records remain reachable internally by canonical path but must
 * never be *suggested* to the model.
 */
function isPublicSymbol(symbol: PythonRuntimeSymbolRecord): boolean {
  return !symbol.name.startsWith('_')
}

function expandPackageAlias(reference: string): string {
  const clean = reference.trim()
  const dotIndex = clean.indexOf('.')
  const head = dotIndex === -1 ? clean : clean.slice(0, dotIndex)
  const expanded = PACKAGE_ALIASES[normalize(head)]
  return expanded ? `${expanded}${clean.slice(head.length)}` : clean
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

/**
 * Pure, deterministic runtime catalog lookup for matplotlib. No I/O, no process
 * execution, no network, no model call: it only ranks records already in the catalog.
 *
 * Public-surface policy: private symbols (name starting with `_`, e.g. the auxiliary
 * `_AxesBase` MRO base) are hidden from exact/short-name lookup, Keyword search and
 * Fuzzy candidates. They stay resolvable internally, so a member inherited from a
 * private base still answers for the public class that declares it in its MRO.
 */
export class MatplotlibApiQueryTree {
  private readonly pathIndex = new Map<string, string>()
  private readonly shortNameIndex = new Map<string, string[]>()

  constructor(private readonly catalog: PythonRuntimeCatalog) {
    for (const [alias, canonical] of Object.entries(catalog.aliasIndex)) {
      this.pathIndex.set(normalize(alias), canonical)
    }
    for (const alias of Object.keys(PACKAGE_ALIASES)) {
      this.pathIndex.set(normalize(alias), PACKAGE_ALIASES[alias])
    }
    for (const [canonical, symbol] of Object.entries(catalog.symbols)) {
      // Every symbol stays in pathIndex: MRO and member-owner resolution need the
      // private bases. Only the short-name surface is restricted to public symbols.
      this.pathIndex.set(normalize(canonical), canonical)
      if (!isPublicSymbol(symbol)) {
        continue
      }
      const shortName = normalize(symbol.name)
      const current = this.shortNameIndex.get(shortName) ?? []
      current.push(canonical)
      this.shortNameIndex.set(shortName, current)
    }
  }

  /** Internal resolution: every catalogued symbol, including private MRO bases. */
  private resolveSymbol(reference: string): PythonRuntimeSymbolRecord | undefined {
    const clean = expandPackageAlias(reference.trim().replace(/\(.*$/, ''))
    const direct = this.pathIndex.get(normalize(clean))
      ?? this.pathIndex.get(normalize(`${ROOT_PACKAGE}.${clean}`))
    if (direct) {
      return this.catalog.symbols[direct]
    }

    const shortMatches = this.shortNameIndex.get(normalize(clean)) ?? []
    if (shortMatches.length === 1) {
      return this.catalog.symbols[shortMatches[0]]
    }

    const topLevel = shortMatches.find((path) => path.startsWith(`${ROOT_PACKAGE}.`) && path.split('.').length === 2)
    return topLevel ? this.catalog.symbols[topLevel] : undefined
  }

  /** Public resolution: the internal result is discarded when the symbol is private. */
  private resolvePublicSymbol(reference: string): PythonRuntimeSymbolRecord | undefined {
    const symbol = this.resolveSymbol(reference)
    return symbol && isPublicSymbol(symbol) ? symbol : undefined
  }

  private resolveClassMember(classSymbol: PythonRuntimeSymbolRecord, memberName: string): MatplotlibQueryMatch | undefined {
    if (classSymbol.kind !== 'class') {
      return undefined
    }

    const ownMember = classSymbol.members?.[memberName]
    if (ownMember) {
      return { type: 'member', confidence: 'exact', classSymbol, memberName, member: ownMember }
    }

    for (const ownerPath of classSymbol.mro?.slice(1) ?? []) {
      const owner = this.resolveSymbol(ownerPath)
      const inherited = owner?.members?.[memberName]
      if (inherited) {
        return { type: 'member', confidence: 'inherited', classSymbol, memberName, member: inherited }
      }
    }
    return undefined
  }

  private splitMemberReference(reference: string): { owner: PythonRuntimeSymbolRecord; member: string } | undefined {
    const parts = expandPackageAlias(reference.trim().replace(/\(.*$/, '')).split('.')
    for (let split = parts.length - 1; split > 0; split -= 1) {
      const owner = this.resolvePublicSymbol(parts.slice(0, split).join('.'))
      if (owner?.kind === 'class') {
        return { owner, member: parts.slice(split).join('.') }
      }
    }
    return undefined
  }

  private exact(reference: string): MatplotlibQueryMatch | undefined {
    const symbol = this.resolvePublicSymbol(reference)
    if (symbol) {
      return { type: 'symbol', confidence: 'exact', symbol }
    }
    const split = this.splitMemberReference(reference)
    return split ? this.resolveClassMember(split.owner, split.member) : undefined
  }

  private fuzzy(reference: string): MatplotlibQueryMatch[] {
    const split = this.splitMemberReference(reference)
    if (split) {
      const candidates = new Map<string, PythonRuntimeMemberRecord>()
      for (const ownerPath of split.owner.mro ?? [split.owner.path]) {
        const owner = this.resolveSymbol(ownerPath)
        for (const [name, member] of Object.entries(owner?.members ?? {})) {
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
        .filter((candidate) => candidate.score <= MAX_FUZZY_SCORE)
        .sort((left, right) => left.score - right.score || left.match.memberName.localeCompare(right.match.memberName))
        .slice(0, MAX_FUZZY_MATCHES)
        .map(({ match }) => match)
    }

    const target = expandPackageAlias(reference.trim()).split('.').at(-1) ?? reference
    return Object.values(this.catalog.symbols)
      .filter(isPublicSymbol)
      .map((symbol) => ({ score: fuzzyScore(target, symbol.name), symbol }))
      .filter((candidate) => candidate.score <= MAX_FUZZY_SCORE)
      .sort((left, right) => left.score - right.score || left.symbol.path.localeCompare(right.symbol.path))
      .slice(0, MAX_FUZZY_MATCHES)
      .map(({ symbol }) => ({ type: 'symbol' as const, confidence: 'fuzzy' as const, symbol }))
  }

  private search(query: string): MatplotlibQueryMatch[] {
    const terms = (query.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? [])
      .map(normalize)
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
    if (terms.length === 0) {
      return []
    }

    const symbolMatches = Object.values(this.catalog.symbols)
      .filter(isPublicSymbol)
      .map((symbol) => ({
        score: terms.reduce((score, term) => score + (normalize(`${symbol.path} ${symbol.doc ?? ''}`).includes(term) ? 1 : 0), 0),
        match: { type: 'symbol' as const, confidence: 'search' as const, symbol }
      }))

    const memberMatches: Array<{ score: number; match: MatplotlibQueryMatch }> = []
    for (const classSymbol of Object.values(this.catalog.symbols)) {
      if (classSymbol.kind !== 'class' || !isPublicSymbol(classSymbol)) {
        continue
      }
      for (const [memberName, member] of Object.entries(classSymbol.members ?? {})) {
        const haystack = normalize(`${classSymbol.path}.${memberName} ${member.doc ?? ''}`)
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
      .sort((left, right) => right.score - left.score || matchKey(left.match).localeCompare(matchKey(right.match)))
      .slice(0, MAX_MATCHES)
      .map(({ match }) => match)
  }

  query(request: { query: string; symbols: string[] }): MatplotlibQueryMatch[] {
    const matches: MatplotlibQueryMatch[] = []
    const seen = new Set<string>()
    const add = (match: MatplotlibQueryMatch): void => {
      const key = matchKey(match)
      if (!seen.has(key)) {
        seen.add(key)
        matches.push(match)
      }
    }

    for (const reference of request.symbols) {
      const exact = this.exact(reference)
      if (!exact) {
        this.fuzzy(reference).forEach(add)
        continue
      }
      add(exact)
      if (exact.type === 'member' && !exact.member.signature) {
        this.fuzzy(reference).forEach(add)
      }
    }

    // Keyword search covers queries without symbols, and queries whose symbols resolved nothing.
    if (matches.length === 0) {
      this.search(request.query).forEach(add)
    }

    return matches.slice(0, MAX_MATCHES)
  }
}

function matchKey(match: MatplotlibQueryMatch): string {
  return match.type === 'symbol'
    ? `symbol:${match.symbol.path}`
    : `member:${match.classSymbol.path}.${match.memberName}`
}
