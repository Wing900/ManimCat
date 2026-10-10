import { ApiRagService } from './api-rag-service'
import { createMiniLmEmbedding } from './mini-lm-embedding'
import type { ApiCatalogPackage } from './types'

export * from './types'
export { ApiRagService, type ApiRagServiceOptions } from './api-rag-service'

/** Packages the product may answer for, in the order they are probed. */
export const API_RAG_PACKAGES: readonly ApiCatalogPackage[] = ['manim', 'matplotlib']

export function createApiRagService(
  packages: readonly ApiCatalogPackage[] = API_RAG_PACKAGES
): ApiRagService {
  return new ApiRagService({
    embedding: createMiniLmEmbedding(),
    packages
  })
}

let apiRagService: ApiRagService | undefined

/**
 * The process-wide instance. Studio Builder and Workflow Code Repair share this one
 * Baseline index, SearchDoc matrix and MiniLM session; nothing constructs a second
 * service per request or per repair attempt.
 */
export function getApiRagService(): ApiRagService {
  if (!apiRagService) {
    apiRagService = createApiRagService()
  }
  return apiRagService
}
