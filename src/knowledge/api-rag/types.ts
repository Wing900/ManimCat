/**
 * Package-neutral API RAG types.
 *
 * Every answer comes from committed data files:
 *
 *   data/api-catalog/<package>/baseline.json           what exists (facts)
 *   data/api-catalog/<package>/search.json             how it is asked for (recall)
 *   data/api-catalog/<package>/search-vectors.f32      the SearchDoc matrix, built once
 *   data/api-catalog/<package>/search-vectors.index.json  its row order, width and model
 *
 * The Search Catalog may only change ranking. Only the Baseline may decide whether
 * an API exists.
 */

export const API_CATALOG_SCHEMA_VERSION = 1

/** Fixed result window. The Builder decides; the retriever never invents a size. */
export const API_RAG_TOP_K = 10

export type ApiCatalogPackage = 'manim' | 'matplotlib'

export type ApiCatalogKind = 'class' | 'function' | 'module' | 'constant'

export type ApiCatalogMemberKind = 'property' | 'staticmethod' | 'classmethod' | 'method' | 'attribute'

export interface ApiCatalogMemberRecord {
  kind: ApiCatalogMemberKind
  /** Class that declares the member, so an inherited member still names its owner. */
  owner: string
  signature?: string
  doc?: string
}

export interface ApiCatalogSymbolRecord {
  name: string
  /** Canonical path, for example `manim.Axes.add_coordinates`. */
  path: string
  kind: ApiCatalogKind
  aliases: string[]
  signature?: string
  doc?: string
  value?: string
  mro?: string[]
  members?: Record<string, ApiCatalogMemberRecord>
}

export interface ApiCatalog {
  schemaVersion: number
  packageName: string
  packageVersion: string
  pythonVersion: string
  moduleCount: number
  moduleErrors: Record<string, string>
  symbols: Record<string, ApiCatalogSymbolRecord>
  aliasIndex: Record<string, string>
}

/** Canonical symbol or `Class.member` → one sentence of `verb + object + context`. */
export type SearchCatalog = Record<string, string>

export interface VerificationEntry {
  requested: string
  /** AMBIGUOUS means several equally good APIs share the requested name: pick from `candidates`. */
  verdict: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS'
  canonicalSymbol?: string
  kind?: string
  owner?: string
  signature?: string
  /**
   * Rank of the candidate that already prints this signature. The verdict points at that row
   * instead of repeating the signature, which the candidate list already carries verbatim.
   * Absent on a verify-only answer, where no candidate exists to point at.
   */
  see_candidate?: number
  /**
   * Canonical symbols whose *member* carries the requested name (`set_color` →
   * `manim.Mobject.set_color`). Present on a `NOT_FOUND` verdict when the name exists elsewhere,
   * so a wrong shape never looks like a missing API.
   */
  suggestions?: string[]
  /** Canonical paths that share the request with equal rank. Present on AMBIGUOUS. */
  candidates?: string[]
}

export interface CandidateEntry {
  rank: number
  symbol: string
  score: number
  kind: string
  /** Alias into the result's `owners` map. The same class repeats on every member of a search. */
  owner?: string
  /** Only the first few rows carry a signature, a doc and an owner; the rest stay one line. */
  signature?: string
  doc?: string
}

export interface ApiSearchInput {
  query?: string
  symbols?: string[]
}

export type ApiSearchMode = 'verify' | 'discover' | 'hybrid'

export interface ApiSearchResult {
  packageName: string
  packageVersion: string
  mode: ApiSearchMode
  /** Present only when the query ran (discover or hybrid). */
  query?: string
  /**
   * Every distinct owner path mentioned by this answer, keyed by the short alias that the
   * `owner` fields carry. Absent when the answer names no owner.
   */
  owners?: Record<string, string>
  /** Baseline verdicts for the symbols the Builder named. */
  verification: VerificationEntry[]
  /** Baseline-augmented Search Catalog hits, best first. */
  candidates: CandidateEntry[]
}

/** The only thing the RAG service knows about text vectors. */
export interface EmbeddingModel {
  readonly dimensions: number
  embed(texts: readonly string[]): Promise<Float32Array[]>
}
