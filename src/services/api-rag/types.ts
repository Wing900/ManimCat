/**
 * Package-neutral API RAG types.
 *
 * Every answer comes from two committed data files:
 *
 *   data/api-catalog/<package>/baseline.json  what exists (facts)
 *   data/api-catalog/<package>/search.json    how it is asked for (recall)
 *
 * The Search Catalog may only change ranking. Only the Baseline may decide whether
 * an API exists.
 */

export const API_CATALOG_SCHEMA_VERSION = 1

/** Fixed result window. The Builder decides; the retriever never invents a size. */
export const API_RAG_TOP_K = 15

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
  verdict: 'FOUND' | 'NOT_FOUND'
  canonicalSymbol?: string
  kind?: string
  owner?: string
  signature?: string
}

export interface CandidateEntry {
  rank: number
  symbol: string
  score: number
  kind: string
  owner?: string
  signature?: string
  doc?: string
  searchDoc: string
}

export interface ApiSearchInput {
  query: string
  symbols?: string[]
}

export interface ApiSearchResult {
  packageName: string
  packageVersion: string
  query: string
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
