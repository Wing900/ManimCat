/**
 * AI Provider Model Catalog
 *
 * Lists the models available on a provider endpoint.
 */

import type { CustomApiConfig } from '../../types'
import { createCustomOpenAIClient } from './provider-client-factory'

export interface ModelDescriptor {
  id: string
}

export async function listBackendAIModels(config: CustomApiConfig): Promise<ModelDescriptor[]> {
  const client = createCustomOpenAIClient(config)
  const page = await client.models.list()
  return page.data.map((m: { id: string }) => ({ id: m.id }))
}
