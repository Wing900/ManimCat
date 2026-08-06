import type {
  StudioMessage,
  StudioRun,
  StudioRender,
  StudioSession,
} from '../protocol/studio-agent-types'

export interface StudioEntityState {
  session: StudioSession | null
  messagesById: Record<string, StudioMessage>
  messageOrder: string[]
  runsById: Record<string, StudioRun>
  runOrder: string[]
  rendersById: Record<string, StudioRender>
  renderOrder: string[]
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
  submitting: boolean
  replacingSession: boolean
  assistantTextByRunId: Record<string, string>
  optimisticAssistantMessageIdByRunId: Record<string, string>
  pendingAssistantMessageId: string | null
}

export interface StudioSessionState {
  entities: StudioEntityState
  connection: StudioConnectionState
  runtime: StudioRuntimeState
  error: string | null
}
