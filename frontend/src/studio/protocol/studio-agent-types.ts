import type { CustomApiConfig } from '../../types/api'
import type { StudioReviewMetadata } from './studio-review-types'

export type StudioAgentType = 'builder' | 'reviewer' | 'designer'
export type StudioKind = 'manim' | 'plot'
export type StudioPermissionLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
export type StudioPermissionMode = 'safe' | 'auto' | 'full'
export type StudioRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StudioTaskStatus =
  | 'proposed'
  | 'pending_confirmation'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
export type StudioTaskType = 'tool-execution' | 'subagent-run' | 'static-check' | 'ai-review' | 'render'
export type StudioWorkType = 'video' | 'plot' | 'review' | 'design' | 'edit' | 'render-fix'
export type StudioWorkStatus = 'proposed' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StudioWorkResultKind = 'render-output' | 'review-report' | 'design-plan' | 'edit-result' | 'failure-report'
export type StudioPermissionDecision = 'once' | 'always' | 'reject'

export interface StudioPermissionRule {
  permission: string
  pattern: string
  action: 'allow' | 'ask' | 'deny'
}

export interface StudioSessionMetadata {
  studioKind?: StudioKind
  permissionMode?: StudioPermissionMode
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
  permissionLevel: StudioPermissionLevel
  permissionRules: StudioPermissionRule[]
  metadata?: StudioSessionMetadata
  createdAt: string
  updatedAt: string
}

export interface StudioRun {
  id: string
  sessionId: string
  status: StudioRunStatus
  inputText: string
  activeAgent: StudioAgentType
  createdAt: string
  completedAt?: string
  error?: string
  metadata?: Record<string, unknown>
}

export interface StudioTask {
  id: string
  sessionId: string
  runId?: string
  workId?: string
  type: StudioTaskType
  status: StudioTaskStatus
  title: string
  detail?: string
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

export interface StudioWork {
  id: string
  sessionId: string
  runId?: string
  type: StudioWorkType
  title: string
  status: StudioWorkStatus
  latestTaskId?: string
  currentResultId?: string
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
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

export interface StudioPermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}

export interface StudioWorkResult {
  id: string
  workId: string
  kind: StudioWorkResultKind
  summary: string
  attachments?: StudioFileAttachment[]
  metadata?: Record<string, unknown> & StudioReviewMetadata
  createdAt: string
}

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

export interface StudioSkillDiscoveryEntry {
  name: string
  description: string
  scope?: 'common' | 'plot' | 'manim'
  tags?: string[]
  version?: string | number
  directory: string
  entryFile: string
  source: 'catalog' | 'workspace'
}

export interface StudioSessionSnapshot {
  session: StudioSession
  messages: StudioMessage[]
  runs: StudioRun[]
  tasks: StudioTask[]
  works: StudioWork[]
  workResults: StudioWorkResult[]
}

export interface StudioCreateSessionInput {
  projectId: string
  directory?: string
  title?: string
  studioKind?: StudioKind
  agentType?: StudioAgentType
  permissionLevel?: StudioPermissionLevel
  workspaceId?: string
}

export interface StudioCreateRunInput {
  sessionId: string
  inputText: string
  projectId?: string
  customApiConfig?: CustomApiConfig
}
