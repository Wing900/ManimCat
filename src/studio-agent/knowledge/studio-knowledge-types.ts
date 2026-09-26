import type { StudioKind } from '../domain/types'

export type StudioKnowledgeStatus = 'found' | 'not_found' | 'unavailable'

export interface StudioKnowledgeRequest {
  kind: StudioKind
  query: string
  symbols: string[]
  maxChars: number
}

export interface StudioKnowledgeResult {
  status: StudioKnowledgeStatus
  source: string
  query: string
  symbols: string[]
  content: string
  cached: boolean
  truncated: boolean
}

export interface StudioKnowledgeProvider {
  lookup: (request: StudioKnowledgeRequest) => Promise<StudioKnowledgeResult>
}
