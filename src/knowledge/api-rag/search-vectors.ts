import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { MINI_LM_MODEL_FILE, miniLmModelDirectory } from './mini-lm-embedding'
import type { ApiCatalogPackage } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Directory holding one package's committed catalogs. */
function packageDataDirectory(packageName: ApiCatalogPackage): string {
  return path.join(process.cwd(), 'data', 'api-catalog', packageName)
}

/**
 * The committed SearchDoc matrix: raw little-endian Float32, one row per Search Catalog key in
 * exactly the order `search.json` lists them.
 */
export function searchVectorsDataPath(packageName: ApiCatalogPackage): string {
  return path.join(packageDataDirectory(packageName), 'search-vectors.f32')
}

/** The row order, the vector width and the model the matrix was built with. */
export function searchVectorsIndexPath(packageName: ApiCatalogPackage): string {
  return path.join(packageDataDirectory(packageName), 'search-vectors.index.json')
}

export interface SearchVectorsIndex {
  dimensions: number
  /** Digest of the model that produced the matrix: a query must use the same one. */
  modelSha256: string
  symbols: string[]
}

export function validateSearchVectorsIndex(
  value: unknown,
  packageName: ApiCatalogPackage
): SearchVectorsIndex {
  if (!isRecord(value)) {
    throw new Error(`Search vector index for ${packageName} must be an object`)
  }
  const { dimensions, modelSha256, symbols } = value
  if (typeof dimensions !== 'number' || !Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Search vector index for ${packageName} has an invalid dimensions field`)
  }
  if (typeof modelSha256 !== 'string' || modelSha256.length !== 64) {
    throw new Error(`Search vector index for ${packageName} has an invalid modelSha256 field`)
  }
  if (!Array.isArray(symbols) || symbols.some((symbol) => typeof symbol !== 'string')) {
    throw new Error(`Search vector index for ${packageName} has an invalid symbols field`)
  }
  return { dimensions, modelSha256, symbols: symbols as string[] }
}

async function assertSameModel(index: SearchVectorsIndex, packageName: ApiCatalogPackage): Promise<void> {
  const modelPath = path.join(miniLmModelDirectory(), MINI_LM_MODEL_FILE)
  let model: Buffer
  try {
    model = await fs.readFile(modelPath)
  } catch (error) {
    throw new Error(`Embedding model is not readable at ${modelPath}: ${String(error)}`)
  }
  const digest = createHash('sha256').update(model).digest('hex')
  if (digest !== index.modelSha256) {
    throw new Error(
      `Search vectors for ${packageName} were built with another model ` +
        `(expected ${index.modelSha256}, found ${digest}): run npm run build:search-vectors`
    )
  }
}

/**
 * Where the SearchDoc matrix comes from. The product reads the committed files; a test that
 * substitutes an embedding model substitutes the matrix that model would have produced.
 */
export interface SearchVectorsSource {
  load(
    packageName: ApiCatalogPackage,
    symbols: readonly string[],
    dimensions: number
  ): Promise<Float32Array>
}

export const committedSearchVectors: SearchVectorsSource = {
  load: (packageName, symbols, dimensions) => loadSearchVectors(packageName, symbols, dimensions)
}

/**
 * Loads the committed SearchDoc matrix for one package. Every mismatch is a data defect and stops
 * the process: a row count, an order or a model that drifted would silently put documents and
 * queries into different vector spaces.
 */
export async function loadSearchVectors(
  packageName: ApiCatalogPackage,
  symbols: readonly string[],
  dimensions: number
): Promise<Float32Array> {
  const indexPath = searchVectorsIndexPath(packageName)
  let indexRaw: string
  try {
    indexRaw = await fs.readFile(indexPath, 'utf8')
  } catch (error) {
    throw new Error(`Search vector index is not readable at ${indexPath}: ${String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(indexRaw) as unknown
  } catch (error) {
    throw new Error(`Search vector index at ${indexPath} is not valid JSON: ${String(error)}`)
  }
  const index = validateSearchVectorsIndex(parsed, packageName)

  if (index.dimensions !== dimensions) {
    throw new Error(
      `Search vectors for ${packageName} are ${index.dimensions}-dimensional but the embedding ` +
        `model returns ${dimensions}: run npm run build:search-vectors`
    )
  }
  if (index.symbols.length !== symbols.length) {
    throw new Error(
      `Search vectors for ${packageName} cover ${index.symbols.length} symbols but the Search ` +
        `Catalog lists ${symbols.length}: run npm run build:search-vectors`
    )
  }
  const driftedRow = index.symbols.findIndex((symbol, position) => symbol !== symbols[position])
  if (driftedRow >= 0) {
    throw new Error(
      `Search vectors for ${packageName} are out of order at row ${driftedRow} ` +
        `(${index.symbols[driftedRow]} vs ${symbols[driftedRow]}): run npm run build:search-vectors`
    )
  }

  await assertSameModel(index, packageName)

  const dataPath = searchVectorsDataPath(packageName)
  let bytes: Buffer
  try {
    bytes = await fs.readFile(dataPath)
  } catch (error) {
    throw new Error(`Search vectors are not readable at ${dataPath}: ${String(error)}`)
  }
  const expectedBytes = symbols.length * dimensions * 4
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `Search vectors at ${dataPath} hold ${bytes.byteLength} bytes, expected ${expectedBytes}: ` +
        'run npm run build:search-vectors'
    )
  }

  // Copy instead of viewing: a Buffer is not guaranteed to sit on a 4-byte boundary.
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
