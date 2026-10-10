import type {
  ApiCatalog,
  ApiCatalogMemberRecord,
  ApiCatalogSymbolRecord,
  VerificationEntry
} from './types'

/** One resolved API, whichever way the Builder or the Search Catalog named it. */
export interface ResolvedApi {
  path: string
  kind: string
  owner?: string
  signature?: string
  doc?: string
}

export interface BaselineResolver {
  readonly catalog: ApiCatalog
  readonly packageName: string
  /** True when the reference resolves to a symbol or `Class.member`. */
  has(reference: string): boolean
  resolve(reference: string): ResolvedApi | undefined
  /** Baseline verdict for one Builder-named symbol. Never guesses. */
  verify(reference: string): VerificationEntry
}

interface ResolvedMember {
  owner: ApiCatalogSymbolRecord
  memberName: string
  member: ApiCatalogMemberRecord
}

function normalize(reference: string): string {
  return reference.trim().replace(/\(.*$/, '').trim().toLowerCase()
}

/**
 * Baseline Resolver: the only layer allowed to decide that an API exists.
 * It answers from the committed Baseline index and performs no fuzzy guessing, so a
 * NOT_FOUND verdict is always trustworthy.
 */
export function createBaselineResolver(catalog: ApiCatalog): BaselineResolver {
  /** Exact canonical path → canonical. An exact spelling always wins. */
  const exactIndex = new Map<string, string>()
  /** Lowercase path → canonicals, best first. `manim.mobject` is both a module and the
   * `manim.Mobject` class, so the bucket must keep every candidate and rank them. */
  const pathIndex = new Map<string, string[]>()
  const shortNameIndex = new Map<string, string[]>()

  const isModulePath = (canonical: string): boolean => catalog.symbols[canonical]?.kind === 'module'

  function indexPath(key: string, canonical: string): void {
    const normalized = normalize(key)
    if (!normalized) {
      return
    }
    const bucket = pathIndex.get(normalized) ?? []
    if (bucket.includes(canonical)) {
      return
    }
    bucket.push(canonical)
    // A class beats the module of the same name, and the shortest path beats a deeper alias.
    bucket.sort((left, right) =>
      Number(isModulePath(left)) - Number(isModulePath(right))
      || left.length - right.length
      || left.localeCompare(right)
    )
    pathIndex.set(normalized, bucket)
  }

  for (const [alias, canonical] of Object.entries(catalog.aliasIndex)) {
    indexPath(alias, canonical)
  }
  for (const [canonical, symbol] of Object.entries(catalog.symbols)) {
    exactIndex.set(canonical, canonical)
    for (const alias of symbol.aliases) {
      exactIndex.set(alias, canonical)
    }
    indexPath(canonical, canonical)
    for (const alias of symbol.aliases) {
      indexPath(alias, canonical)
    }
    const shortName = normalize(symbol.name)
    const bucket = shortNameIndex.get(shortName)
    if (bucket) {
      bucket.push(canonical)
    } else {
      shortNameIndex.set(shortName, [canonical])
    }
  }

  const packagePrefix = `${catalog.packageName}.`

  /** Member names are matched case-insensitively, so camelCase members stay reachable. */
  const memberKeyIndex = new Map<string, Map<string, string>>()
  for (const [canonical, symbol] of Object.entries(catalog.symbols)) {
    const members = symbol.members
    if (!members) {
      continue
    }
    const byLowerName = new Map<string, string>()
    for (const memberName of Object.keys(members)) {
      const lower = normalize(memberName)
      if (!byLowerName.has(lower)) {
        byLowerName.set(lower, memberName)
      }
    }
    memberKeyIndex.set(canonical, byLowerName)
  }

  function memberNamed(owner: ApiCatalogSymbolRecord, memberName: string): ApiCatalogMemberRecord | undefined {
    const members = owner.members
    if (!members) {
      return undefined
    }
    const exact = members[memberName]
    if (exact) {
      return exact
    }
    const actualName = memberKeyIndex.get(owner.path)?.get(normalize(memberName))
    return actualName ? members[actualName] : undefined
  }

  function symbolFor(reference: string): ApiCatalogSymbolRecord | undefined {
    const trimmed = reference.trim()
    const clean = normalize(trimmed)
    if (!clean) {
      return undefined
    }

    const exact = exactIndex.get(trimmed) ?? exactIndex.get(trimmed.replace(/\(.*$/, '').trim())
    if (exact) {
      return catalog.symbols[exact]
    }

    const direct = pathIndex.get(clean)?.[0] ?? pathIndex.get(`${packagePrefix}${clean}`)?.[0]
    if (direct) {
      return catalog.symbols[direct]
    }

    const shortMatches = shortNameIndex.get(clean) ?? []
    if (shortMatches.length === 1) {
      return catalog.symbols[shortMatches[0]]
    }
    const topLevel = shortMatches.find(
      (path) => path.startsWith(packagePrefix) && path.split('.').length === 2
    )
    return topLevel ? catalog.symbols[topLevel] : undefined
  }

  function memberFor(reference: string): ResolvedMember | undefined {
    const parts = normalize(reference).split('.')
    for (let split = parts.length - 1; split > 0; split -= 1) {
      const owner = classFor(parts.slice(0, split).join('.'))
      if (!owner) {
        continue
      }
      const memberName = parts.slice(split).join('.')

      const ownMember = memberNamed(owner, memberName)
      if (ownMember) {
        return { owner, memberName, member: ownMember }
      }
      for (const ownerPath of owner.mro?.slice(1) ?? []) {
        const inherited = catalog.symbols[pathIndex.get(normalize(ownerPath))?.[0] ?? ownerPath]
        const inheritedMember = inherited ? memberNamed(inherited, memberName) : undefined
        if (inheritedMember) {
          return { owner, memberName, member: inheritedMember }
        }
      }
    }
    return undefined
  }

  /** Member owners are always classes: `manim.mobject.hashing` must not shadow `manim.Mobject`. */
  function classFor(reference: string): ApiCatalogSymbolRecord | undefined {
    const candidates = pathIndex.get(normalize(reference)) ?? []
    const ownerPath = candidates.find((canonical) => catalog.symbols[canonical]?.kind === 'class')
    if (ownerPath) {
      return catalog.symbols[ownerPath]
    }
    const symbol = symbolFor(reference)
    return symbol?.kind === 'class' ? symbol : undefined
  }

  function resolve(reference: string): ResolvedApi | undefined {
    const symbol = symbolFor(reference)
    if (symbol) {
      const resolved: ResolvedApi = { path: symbol.path, kind: symbol.kind }
      if (symbol.signature) resolved.signature = symbol.signature
      if (symbol.doc) resolved.doc = symbol.doc
      return resolved
    }

    const member = memberFor(reference)
    if (!member) {
      return undefined
    }
    const resolved: ResolvedApi = {
      path: `${member.owner.path}.${member.memberName}`,
      kind: member.member.kind,
      owner: member.member.owner
    }
    if (member.member.signature) resolved.signature = member.member.signature
    if (member.member.doc) resolved.doc = member.member.doc
    return resolved
  }

  return {
    catalog,
    packageName: catalog.packageName,
    has: (reference) => resolve(reference) !== undefined,
    resolve,
    verify(reference): VerificationEntry {
      const requested = reference.trim()
      const resolved = resolve(requested)
      if (!resolved) {
        return { requested, verdict: 'NOT_FOUND' }
      }
      const entry: VerificationEntry = {
        requested,
        verdict: 'FOUND',
        canonicalSymbol: resolved.path,
        kind: resolved.kind
      }
      if (resolved.owner) entry.owner = resolved.owner
      if (resolved.signature) entry.signature = resolved.signature
      return entry
    }
  }
}
