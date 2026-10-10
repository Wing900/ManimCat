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
    const hits = index.retriever.search(queryEmbedding, this.topK)
    const candidates: CandidateEntry[] = hits.map((hit, position) => {
      const resolved = index.resolver.resolve(hit.symbol)
      const candidate: CandidateEntry = {
        rank: position + 1,
        symbol: resolved?.path ?? hit.symbol,
        score: hit.score,
        kind: resolved?.kind ?? 'unknown',
        searchDoc: hit.searchDoc
      }
      if (resolved?.owner) candidate.owner = resolved.owner
      if (resolved?.signature) candidate.signature = resolved.signature
      if (resolved?.doc) candidate.doc = resolved.doc
      return candidate
    })

    return {
      packageName: index.catalog.packageName,
      packageVersion: index.catalog.packageVersion,
      mode: requested.length > 0 ? 'hybrid' : 'discover',
      query,
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
