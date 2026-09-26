import type { StudioFileAttachment } from './message-types'

export type StudioAgentType = 'builder'
export type StudioKind = 'manim' | 'plot'
export type StudioToolChoice = 'auto' | 'required' | 'none'

export interface StudioPrincipal {
  ownerId: string
}

export type StudioRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type StudioRenderStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface StudioRender {
  id: string
  ownerId: string
  sessionId: string
  runId?: string
  kind: StudioKind
  title: string
  status: StudioRenderStatus
  concept: string
  outputMode: 'video' | 'image'
  quality?: 'low' | 'medium' | 'high'
  jobId?: string
  sourcePath?: string
  attachments?: StudioFileAttachment[]
  error?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StudioSession {
  id: string
  ownerId: string
  projectId: string
  workspaceId?: string
  parentSessionId?: string
  studioKind?: StudioKind
  agentType: StudioAgentType
  title: string
  directory: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * Cumulative, provider-neutral Studio token accounting. One value per Studio run.
 *
 * A call is measured when the provider response carried at least one usable token
 * counter, unmeasured when it carried none or the invocation threw. Individual missing
 * counters contribute zero. `measuredCalls + unmeasuredCalls` equals the number of
 * model invocations observed by the Studio loop.
 */
export interface StudioTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  measuredCalls: number
  unmeasuredCalls: number
}

export interface StudioRun {
  id: string
  ownerId: string
  sessionId: string
  status: StudioRunStatus
  inputText: string
  activeAgent: StudioAgentType
  createdAt: string
  completedAt?: string
  error?: string
  metadata?: Record<string, unknown>
  tokenUsage?: StudioTokenUsage
}
