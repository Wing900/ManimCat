import type {
  StudioMessage,
  StudioPermissionRequest,
  StudioRun,
  StudioSession,
  StudioTask,
  StudioWork,
  StudioWorkResult,
} from '../protocol/studio-agent-types'

export interface StudioEntityState {
  session: StudioSession | null
  messagesById: Record<string, StudioMessage>
  messageOrder: string[]
  runsById: Record<string, StudioRun>
  runOrder: string[]
  tasksById: Record<string, StudioTask>
  taskOrder: string[]
  worksById: Record<string, StudioWork>
  workOrder: string[]
  workResultsById: Record<string, StudioWorkResult>
  workResultOrder: string[]
  pendingPermissionsById: Record<string, StudioPermissionRequest>
  pendingPermissionOrder: string[]
}

export interface StudioConnectionState {
  snapshotStatus: 'idle' | 'loading' | 'ready' | 'error'
  eventStatus: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  eventError: string | null
  lastEventAt: number | null
  lastEventType: string | null
}

export interface StudioRuntimeState {
  activeRunId: string | null
  assistantTextByRunId: Record<string, string>
  replyingPermissionIds: Record<string, boolean>
  latestQuestion: {
    runId: string
    question: string
    details?: string
  } | null
}

export interface StudioSessionState {
  entities: StudioEntityState
  connection: StudioConnectionState
  runtime: StudioRuntimeState
  error: string | null
}
