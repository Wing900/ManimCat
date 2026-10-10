import fs from 'node:fs'
import type { BaselineResolver } from './baseline-resolver'
import { searchCatalogPath } from './baseline-catalog'
import type { ApiCatalogPackage, SearchCatalog } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The Search Catalog is a flat map of canonical symbol → one sentence. Anything else
 * (nested objects, empty sentences, non-canonical keys) is a data defect.
 */
export function validateSearchCatalog(value: unknown, packageName: ApiCatalogPackage): SearchCatalog {
  if (!isRecord(value)) {
    throw new Error(`Search catalog for ${packageName} must be an object of symbol to sentence`)
  }

  const entries: SearchCatalog = {}
  for (const [symbol, sentence] of Object.entries(value)) {
    if (typeof sentence !== 'string' || sentence.trim().length === 0) {
      throw new Error(`Search catalog for ${packageName} has an empty sentence for ${symbol}`)
    }
    entries[symbol] = sentence
  }
  return entries
}

/**
 * The one reader of a Search Catalog. Registration runs while the Tool registry is built, which
 * is synchronous, so this read is synchronous too: one file read, one validation, no second cache
 * and no async twin beside it. A missing file means "this package has no Search Catalog yet" (not
 * registered); a malformed file is a data defect and stops the process.
 */
export function readSearchCatalog(packageName: ApiCatalogPackage): SearchCatalog | null {
  const filePath = searchCatalogPath(packageName)
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`Search catalog at ${filePath} is not valid JSON: ${String(error)}`)
  }
  const entries = validateSearchCatalog(parsed, packageName)
  return Object.keys(entries).length > 0 ? entries : null
}

/**
 * Every recall key must name something the Baseline can resolve. A key that resolves
 * nowhere is a data defect: it would let the retriever surface a symbol the augmenter
 * cannot describe.
 */
export function assertSearchCatalogResolvable(
  entries: SearchCatalog,
  resolver: BaselineResolver,
  packageName: ApiCatalogPackage
): void {
  const unresolved = Object.keys(entries).filter((symbol) => !resolver.has(symbol))
  if (unresolved.length > 0) {
    const sample = unresolved.slice(0, 5).join(', ')
    throw new Error(
      `Search catalog for ${packageName} has ${unresolved.length} unresolvable keys: ${sample}`
    )
  }
}
