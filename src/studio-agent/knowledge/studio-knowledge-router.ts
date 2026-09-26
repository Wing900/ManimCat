import type { StudioKind } from '../domain/types'
import type { StudioKnowledgeProvider, StudioKnowledgeRequest } from './studio-knowledge-types'
import { createUnavailableStudioKnowledgeProvider } from './unavailable-studio-knowledge-provider'

/**
 * Selects the Knowledge provider from the trusted Studio kind. Model or user input
 * never chooses the provider namespace; the kind travels from StudioSession.
 */
export class StudioKnowledgeRouter implements StudioKnowledgeProvider {
  private readonly adapters: Partial<Record<StudioKind, StudioKnowledgeProvider>>
  private readonly fallback: StudioKnowledgeProvider

  constructor(options: {
    adapters: Partial<Record<StudioKind, StudioKnowledgeProvider>>
    fallback?: StudioKnowledgeProvider
  }) {
    this.adapters = { ...options.adapters }
    this.fallback = options.fallback ?? createUnavailableStudioKnowledgeProvider()
  }

  async lookup(request: StudioKnowledgeRequest) {
    const adapter = this.adapters[request.kind] ?? this.fallback
    return adapter.lookup(request)
  }
}
