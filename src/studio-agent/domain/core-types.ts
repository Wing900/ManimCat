import type { StudioFileAttachment } from './message-types'

export type StudioAgentType = 'builder' | 'reviewer' | 'designer'
export type StudioKind = 'manim' | 'plot'
export type StudioToolChoice = 'auto' | 'required' | 'none'

export type StudioPermissionLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'

export type StudioRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type StudioTaskStatus =
  | 'proposed'
  | 'pending_confirmation'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type StudioTaskType =
  | 'tool-execution'
  | 'subagent-run'
  | 'static-check'
  | 'ai-review'
  | 'render'

export type StudioWorkType = 'video' | 'plot' | 'review' | 'design' | 'edit' | 'render-fix'

export type StudioWorkStatus =
  | 'proposed'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type StudioWorkResultKind =
  | 'render-output'
  | 'review-report'
  | 'design-plan'
  | 'edit-result'
  | 'failure-report'

export type StudioSessionEventStatus = 'pending' | 'consumed'
export type StudioSessionEventKind = 'render-status'

export interface StudioPermissionRule {
  permission: string
  pattern: string
  action: 'allow' | 'deny'
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
  metadata?: Record<string, unknown>
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

export interface StudioWorkResult {
  id: string
  workId: string
  kind: StudioWorkResultKind
  summary: string
  attachments?: StudioFileAttachment[]
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface StudioSessionEvent {
  id: string
  sessionId: string
  runId?: string
  kind: StudioSessionEventKind
  status: StudioSessionEventStatus
  title: string
  summary: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  consumedAt?: string
}
