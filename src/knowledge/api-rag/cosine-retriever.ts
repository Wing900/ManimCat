export interface RetrievalEntry {
  /** Canonical symbol or `Class.member`; the Search Catalog key. */
  symbol: string
  searchDoc: string
  embedding: Float32Array
}

export interface RetrievalHit {
  symbol: string
  searchDoc: string
  score: number
}

export interface CosineRetriever {
  readonly size: number
  search(queryEmbedding: Float32Array, topK: number): RetrievalHit[]
}

/** Unit length, so cosine similarity is a plain dot product. */
export function l2Normalize(vector: Float32Array): Float32Array {
  let sum = 0
  for (const value of vector) {
    sum += value * value
  }
  const norm = Math.sqrt(sum)
  if (norm === 0) {
    throw new Error('Embedding vector has zero length')
  }
  const normalized = new Float32Array(vector.length)
  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index] / norm
  }
  return normalized
}

function dot(left: Float32Array, right: Float32Array): number {
  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index]
  }
  return total
}

/**
 * In-process cosine retriever. 860 SearchDoc entries need no vector database: the
 * matrix is small enough to hold as one Float32Array per entry.
 */
export function createCosineRetriever(
  entries: readonly RetrievalEntry[],
  dimensions: number
): CosineRetriever {
  if (entries.length === 0) {
    throw new Error('Cosine retriever requires at least one Search Catalog entry')
  }
  for (const entry of entries) {
    if (entry.embedding.length !== dimensions) {
      throw new Error(
        `Embedding dimension mismatch for ${entry.symbol}: ${entry.embedding.length} is not ${dimensions}`
      )
    }
  }

  const normalized = entries.map((entry) => ({
    symbol: entry.symbol,
    searchDoc: entry.searchDoc,
    embedding: l2Normalize(entry.embedding)
  }))

  return {
    size: normalized.length,
    search(queryEmbedding, topK) {
      if (queryEmbedding.length !== dimensions) {
        throw new Error(
          `Query embedding dimension mismatch: ${queryEmbedding.length} is not ${dimensions}`
        )
      }
      const query = l2Normalize(queryEmbedding)
      const hits: RetrievalHit[] = normalized.map((entry) => ({
        symbol: entry.symbol,
        searchDoc: entry.searchDoc,
        score: dot(query, entry.embedding)
      }))
      hits.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
      return hits.slice(0, topK)
    }
  }
}
