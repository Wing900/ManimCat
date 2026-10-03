import type { CustomApiConfig } from '../../types/api'

export type StudioAgentType = 'builder'
export type StudioKind = 'manim' | 'plot'
export type StudioRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StudioRenderStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface StudioSessionMetadata {
  studioKind?: StudioKind
  agentConfig?: {
    toolChoice?: 'auto' | 'required' | 'none'
  }
  [key: string]: unknown
}

export interface StudioSession {
  id: string
  projectId: string
  workspaceId?: string
  parentSessionId?: string
  studioKind?: StudioKind
  agentType: StudioAgentType
  title: string
  directory: string
  metadata?: StudioSessionMetadata
  createdAt: string
  updatedAt: string
}

export interface StudioTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  measuredCalls: number
  unmeasuredCalls: number
}

export interface StudioRun {
  id: string
  sessionId: string
  /** Optional Scene scope; absent means a legacy Session-scoped Run. */
  sceneId?: string
  status: StudioRunStatus
  inputText: string
  activeAgent: StudioAgentType
  createdAt: string
  completedAt?: string
  error?: string
  metadata?: Record<string, unknown>
  tokenUsage?: StudioTokenUsage
}

export interface StudioRender {
  id: string
  ownerId?: string
  sessionId: string
  /** Optional Scene scope; absent means a legacy Session-scoped render. */
  sceneId?: string
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

export interface StudioFileAttachment {
  kind: 'file'
  path: string
  name?: string
  mimeType?: string
}

export interface StudioMessageBase {
  id: string
  renderId?: string
  sessionId: string
  /** Optional Scene scope, inherited by every Part through this Message. */
  sceneId?: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  createdAt: string
  updatedAt: string
}

export interface StudioPartTimeRange {
  start: number
  end?: number
}

export interface StudioTextPart {
  id: string
  messageId: string
  sessionId: string
  type: 'text'
  text: string
  time?: StudioPartTimeRange
}

export interface StudioReasoningPart {
  id: string
  messageId: string
  sessionId: string
  type: 'reasoning'
  text: string
  time?: StudioPartTimeRange
}

export interface StudioToolStatePending {
  status: 'pending'
  input: Record<string, unknown>
  raw: string
}

export interface StudioToolStateRunning {
  status: 'running'
  input: Record<string, unknown>
  title?: string
  metadata?: Record<string, unknown>
  time: StudioPartTimeRange
}

export interface StudioToolStateCompleted {
  status: 'completed'
  input: Record<string, unknown>
  output: string
  title: string
  metadata?: Record<string, unknown>
  time: StudioPartTimeRange
  attachments?: StudioFileAttachment[]
}

export interface StudioToolStateError {
  status: 'error'
  input: Record<string, unknown>
  error: string
  metadata?: Record<string, unknown>
  time: StudioPartTimeRange
}

export type StudioToolState =
  | StudioToolStatePending
  | StudioToolStateRunning
  | StudioToolStateCompleted
  | StudioToolStateError

export interface StudioToolPart {
  id: string
  messageId: string
  sessionId: string
  type: 'tool'
  tool: string
  callId: string
  state: StudioToolState
  metadata?: Record<string, unknown>
}

export type StudioMessagePart = StudioTextPart | StudioReasoningPart | StudioToolPart

export interface StudioAssistantMessage extends StudioMessageBase {
  role: 'assistant'
  agent: StudioAgentType
  parts: StudioMessagePart[]
  summary?: string
}

export interface StudioUserMessage extends StudioMessageBase {
  role: 'user'
  text: string
}

export type StudioMessage = StudioAssistantMessage | StudioUserMessage

export interface StudioApiError {
  code: string
  message: string
  details?: unknown
}

export interface StudioApiEnvelopeSuccess<T> {
  ok: true
  data: T
}

export interface StudioApiEnvelopeFailure {
  ok: false
  error: StudioApiError
}

export type StudioApiEnvelope<T> = StudioApiEnvelopeSuccess<T> | StudioApiEnvelopeFailure


export interface StudioSessionSnapshot {
  session: StudioSession
  messages: StudioMessage[]
  runs: StudioRun[]
  renders: StudioRender[]
  /** Ordered Scenes; absent on responses produced before Scene support. */
  scenes?: StudioScene[]
}

/** One ordered Scene beneath a Session, in its public (sanitized) shape. */
export interface StudioScene {
  id: string
  sessionId: string
  position: number
  createdAt: string
  updatedAt: string
}

/** One Scene with only its own records, in the Scene public projection. */
export interface StudioSceneSnapshot {
  scene: StudioScene
  messages: StudioSceneMessage[]
  runs: StudioSceneRun[]
  renders: StudioSceneRender[]
}

/**
 * Scene public projection, mirroring the backend whitelist exactly: no internal error text, no
 * private source path, no arbitrary Tool metadata and no model-supplied Tool input. The legacy
 * Session snapshot keeps its wider `StudioRun`/`StudioRender`, so this narrows the Scene response
 * only and a Scene consumer must not cast a wider record into these types.
 */
export interface StudioSceneAttachment {
  kind: 'file'
  path: string
  name?: string
  mimeType?: string
}

export interface StudioSceneRun {
  id: string
  sessionId: string
  sceneId?: string
  status: StudioRunStatus
  inputText: string
  activeAgent: StudioAgentType
  createdAt: string
  completedAt?: string
  tokenUsage?: StudioTokenUsage
}

export interface StudioSceneRender {
  id: string
  sessionId: string
  sceneId?: string
  runId?: string
  kind: StudioKind
  title: string
  status: StudioRenderStatus
  concept: string
  outputMode: 'video' | 'image'
  quality?: 'low' | 'medium' | 'high'
  jobId?: string
  attachments?: StudioSceneAttachment[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface StudioSceneToolState {
  status: 'pending' | 'running' | 'completed' | 'error'
  title?: string
  output?: string
  time?: StudioPartTimeRange
  attachments?: StudioSceneAttachment[]
  metadata?: Record<string, unknown>
}

export interface StudioSceneTextPart {
  id: string
  messageId: string
  sessionId: string
  type: 'text'
  text: string
  time?: StudioPartTimeRange
}

export interface StudioSceneReasoningPart {
  id: string
  messageId: string
  sessionId: string
  type: 'reasoning'
  text: string
  time?: StudioPartTimeRange
}

export interface StudioSceneToolPart {
  id: string
  messageId: string
  sessionId: string
  type: 'tool'
  tool: string
  callId: string
  state: StudioSceneToolState
  metadata?: Record<string, unknown>
}

export type StudioScenePart = StudioSceneTextPart | StudioSceneReasoningPart | StudioSceneToolPart

export interface StudioSceneUserMessage {
  id: string
  sessionId: string
  sceneId?: string
  role: 'user'
  text: string
  createdAt: string
  updatedAt: string
}

export interface StudioSceneAssistantMessage {
  id: string
  sessionId: string
  sceneId?: string
  role: 'assistant'
  agent: StudioAgentType
  parts: StudioScenePart[]
  summary?: string
  createdAt: string
  updatedAt: string
}

export type StudioSceneMessage = StudioSceneUserMessage | StudioSceneAssistantMessage

export interface StudioCreateSessionInput {
  projectId: string
  directory?: string
  title?: string
  studioKind?: StudioKind
  agentType?: StudioAgentType
  workspaceId?: string
}

export interface StudioCreateRunInput {
  sessionId: string
  inputText: string
  projectId?: string
  customApiConfig?: CustomApiConfig
}

/**
 * Scene Run body. Session and Scene identity come from the URL, so the body carries no identity
 * field at all: the backend parser is strict and rejects an attempted override.
 */
export interface StudioCreateSceneRunInput {
  inputText: string
  projectId?: string
  customApiConfig?: CustomApiConfig
  toolChoice?: 'auto' | 'required' | 'none'
}

/** Accepted Scene Run response: the selected Scene's own records plus the accepted Run. */
export interface StudioCreateSceneRunResponse extends StudioSceneSnapshot {
  run: StudioSceneRun
}
