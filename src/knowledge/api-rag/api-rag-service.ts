import { createBaselineResolver, type BaselineResolver } from './baseline-resolver'
import { loadBaselineCatalog } from './baseline-catalog'
import { createCosineRetriever, type CosineRetriever } from './cosine-retriever'
import {
  assertSearchCatalogResolvable,
  readSearchCatalog
} from './search-catalog'
import { committedSearchVectors, type SearchVectorsSource } from './search-vectors'
import {
  API_RAG_TOP_K,
  type ApiCatalog,
  type ApiCatalogPackage,
  type ApiSearchInput,
  type ApiSearchResult,
  type CandidateEntry,
  type EmbeddingModel,
  type SearchCatalog,
  type VerificationEntry
} from './types'

/** One class may own most of the best hits; past this many, its variants make room for others. */
const VARIANTS_PER_OWNER = 2

/** Rows past this one arrive as `rank, symbol, kind, score`; the Builder re-queries for detail. */
const FULL_DETAIL_ROWS = 3

interface PackageIndex {
  catalog: ApiCatalog
  resolver: BaselineResolver
  retriever: CosineRetriever
}

export interface ApiRagServiceOptions {
  embedding: EmbeddingModel
  /** Packages this process may answer for. A package without a Search Catalog stays unregistered. */
  packages: readonly ApiCatalogPackage[]
  topK?: number
  /** Defaults to the committed SearchDoc matrices under data/api-catalog. */
  searchVectors?: SearchVectorsSource
}

/**
 * The one query path of the product.
 *
 *   symbols → Baseline Resolver → verification (does it exist?)
 *   query   → SearchDoc retriever → candidates → Baseline facts (what is it?)
 *
 * Fails fast: a missing or malformed data file, an unresolvable search key, a missing
 * model or a dimension mismatch stops the process instead of degrading to a guess.
 */
export class ApiRagService {
  private readonly embedding: EmbeddingModel
  private readonly searchVectors: SearchVectorsSource
  private readonly topK: number
  private readonly registrations = new Map<ApiCatalogPackage, SearchCatalog>()
  private readonly indexes = new Map<ApiCatalogPackage, Promise<PackageIndex>>()

  constructor(options: ApiRagServiceOptions) {
    this.embedding = options.embedding
    this.searchVectors = options.searchVectors ?? committedSearchVectors
    this.topK = options.topK ?? API_RAG_TOP_K
    for (const packageName of options.packages) {
      const searchCatalog = readSearchCatalog(packageName)
      if (searchCatalog) {
        this.registrations.set(packageName, searchCatalog)
      }
    }
  }

  /** Packages with a Search Catalog. The tool registry follows this list. */
  get registeredPackages(): ApiCatalogPackage[] {
    return [...this.registrations.keys()]
  }

  isRegistered(packageName: ApiCatalogPackage): boolean {
    return this.registrations.has(packageName)
  }

  /**
   * Loads every index and encodes the SearchDoc matrix once. This is the single loading door: the
   * composition root awaits it before the listener opens, and a missing or malformed data file
   * aborts startup instead of degrading to a guess.
   */
  async ready(): Promise<void> {
    await Promise.all(this.registeredPackages.map((packageName) => this.packageIndex(packageName)))
  }

  async search(packageName: ApiCatalogPackage, input: ApiSearchInput): Promise<ApiSearchResult> {
    if (!this.registrations.has(packageName)) {
      throw new Error(`API RAG is not registered for ${packageName}: it has no Search Catalog`)
    }
    const query = input.query?.trim() ?? ''
    const requested = (input.symbols ?? []).map((symbol) => symbol.trim()).filter(Boolean)
    if (!query && requested.length === 0) {
      throw new Error('search_api requires a query, symbols, or both')
    }

    const index = await this.packageIndex(packageName)
    const verification: VerificationEntry[] = requested.map((symbol) => index.resolver.verify(symbol))

    // Verify-only: no embedding, no candidates.
    if (!query) {
      return {
        packageName: index.catalog.packageName,
        packageVersion: index.catalog.packageVersion,
        mode: 'verify',
        verification,
        candidates: []
      }
    }

    const [queryEmbedding] = await this.embedding.embed([query])
    // Score the whole index rather than a slice: scoring already visits every entry, and a symbol
    // the Builder named must be pinnable however badly the query ranked it.
    const hits = index.retriever.search(queryEmbedding, index.retriever.size)
    const verifiedSymbols = verification
      .filter((entry) => entry.verdict === 'FOUND' && entry.canonicalSymbol)
      .map((entry) => entry.canonicalSymbol as string)
    const candidates = selectCandidates((symbol) => index.resolver.resolve(symbol), hits, verifiedSymbols, this.topK)

    // A member's owner is a full dotted path, and one class owns most of a search: repeating it
    // costs more than every other field trim combined. Each distinct path is written once into
    // `owners` and referenced by its short alias, which the Builder reads back through the map.
    const owners = buildOwnerAliases([...verification, ...candidates])

    // A verified symbol that also arrives as a candidate already carries its signature: the
    // verdict points at that row rather than printing the same text twice. A verify-only answer
    // keeps the signature, because there is no candidate to point at.
    const rankBySymbol = new Map(candidates.map((candidate) => [candidate.symbol, candidate.rank]))
    for (const entry of verification) {
      const rank = entry.canonicalSymbol ? rankBySymbol.get(entry.canonicalSymbol) : undefined
      if (rank === undefined) continue
      delete entry.signature
      entry.see_candidate = rank
    }

    return {
      packageName: index.catalog.packageName,
      packageVersion: index.catalog.packageVersion,
      mode: requested.length > 0 ? 'hybrid' : 'discover',
      query,
      ...(Object.keys(owners).length > 0 ? { owners } : {}),
      verification,
      candidates
    }
  }

  private packageIndex(packageName: ApiCatalogPackage): Promise<PackageIndex> {
    const cached = this.indexes.get(packageName)
    if (cached) {
      return cached
    }

    const pending = this.buildPackageIndex(packageName).catch((error: unknown) => {
      this.indexes.delete(packageName)
      throw error
    })
    this.indexes.set(packageName, pending)
    return pending
  }

  private async buildPackageIndex(packageName: ApiCatalogPackage): Promise<PackageIndex> {
    // Only a registered package reaches this point, so the Search Catalog is already in memory.
    const searchCatalog = this.registrations.get(packageName)
    if (!searchCatalog) {
      throw new Error(`API RAG is not registered for ${packageName}: it has no Search Catalog`)
    }

    const catalog = await loadBaselineCatalog(packageName)
    const resolver = createBaselineResolver(catalog)
    assertSearchCatalogResolvable(searchCatalog, resolver, packageName)

    // The document vectors are committed, so startup reads them instead of encoding 1352 rows.
    // The loader proves the row order, the width and the model match this process.
    const symbols = Object.keys(searchCatalog)
    const dimensions = this.embedding.dimensions
    const vectors = await this.searchVectors.load(packageName, symbols, dimensions)

    const retriever = createCosineRetriever(
      symbols.map((symbol, position) => ({
        symbol,
        searchDoc: searchCatalog[symbol],
        embedding: vectors.subarray(position * dimensions, (position + 1) * dimensions)
      })),
      dimensions
    )

    return { catalog, resolver, retriever }
  }
}

/**
 * Writes each distinct owner path once and rewrites every `owner` field to its short alias.
 * The alias is the last path segment; a second class with the same short name gets a `#2` suffix.
 * Mutates the entries in place, so callers pass the objects they are about to return.
 */
export function buildOwnerAliases(entries: Array<{ owner?: string }>): Record<string, string> {
  const aliasByPath = new Map<string, string>()
  const aliases: Record<string, string> = {}
  for (const entry of entries) {
    const path = entry.owner
    if (!path) continue
    let alias = aliasByPath.get(path)
    if (!alias) {
      const base = path.split('.').pop() ?? path
      alias = base
      for (let suffix = 2; aliases[alias] !== undefined; suffix += 1) {
        alias = `${base}#${suffix}`
      }
      aliases[alias] = path
      aliasByPath.set(path, alias)
    }
    entry.owner = alias
  }
  return aliases
}

interface CandidateDraft {
  symbol: string
  score: number
  kind: string
  owner?: string
  signature?: string
  doc?: string
}

/**
 * Fills the result window from the retriever's ranked rows, in three steps:
 *
 *   1. the symbols the Builder named come first, in the order it named them, so an answer never
 *      buries the API the caller already asked about;
 *   2. past `variantsPerOwner` rows, a further member of the same class yields its slot, so one
 *      class cannot crowd out the API the query was actually about;
 *   3. past `FULL_DETAIL_ROWS` rows a candidate arrives as one line, keeping the long tail
 *      discoverable without paying a signature and a doc for every row.
 */
export function selectCandidates(
  resolve: (symbol: string) => { path: string; kind: string; owner?: string; signature?: string; doc?: string } | undefined,
  hits: ReadonlyArray<{ symbol: string; score: number }>,
  verifiedSymbols: readonly string[],
  limit: number,
  variantsPerOwner: number = VARIANTS_PER_OWNER
): CandidateEntry[] {
  const drafts: CandidateDraft[] = hits.map((hit) => {
    const resolved = resolve(hit.symbol)
    const draft: CandidateDraft = {
      symbol: resolved?.path ?? hit.symbol,
      score: hit.score,
      kind: resolved?.kind ?? 'unknown'
    }
    if (resolved?.owner) draft.owner = resolved.owner
    if (resolved?.signature) draft.signature = resolved.signature
    if (resolved?.doc) draft.doc = resolved.doc
    return draft
  })

  const bySymbol = new Map(drafts.map((draft) => [draft.symbol, draft]))
  const pinned: CandidateDraft[] = []
  for (const symbol of verifiedSymbols) {
    const draft = bySymbol.get(symbol)
    if (draft && !pinned.includes(draft)) pinned.push(draft)
  }
  const pinnedSymbols = new Set(pinned.map((draft) => draft.symbol))

  const kept: CandidateDraft[] = []
  const ownerCounts = new Map<string, number>()
  for (const draft of [...pinned, ...drafts.filter((entry) => !pinnedSymbols.has(entry.symbol))]) {
    if (kept.length >= limit) break
    const isPinned = pinnedSymbols.has(draft.symbol)
    if (draft.owner) {
      const used = ownerCounts.get(draft.owner) ?? 0
      if (!isPinned && used >= variantsPerOwner) continue
      ownerCounts.set(draft.owner, used + 1)
    }
    kept.push(draft)
  }

  return kept.map((draft, index) => {
    const rank = index + 1
    // A row the Builder named stays in full wherever it landed: it is the row it must call.
    if (index < FULL_DETAIL_ROWS || pinnedSymbols.has(draft.symbol)) {
      const entry: CandidateEntry = { rank, symbol: draft.symbol, score: draft.score, kind: draft.kind }
      if (draft.owner) entry.owner = draft.owner
      if (draft.signature) entry.signature = draft.signature
      if (draft.doc) entry.doc = draft.doc
      return entry
    }
    return { rank, symbol: draft.symbol, score: draft.score, kind: draft.kind }
  })
}
