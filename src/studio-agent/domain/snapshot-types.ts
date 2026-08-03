import type { StudioRun, StudioSession, StudioTask, StudioWork, StudioWorkResult, StudioSessionEvent } from './core-types'
import type { StudioMessage } from './message-types'

export interface StudioSessionSnapshot {
  session: StudioSession
  messages: StudioMessage[]
  runs: StudioRun[]
  sessionEvents: StudioSessionEvent[]
  tasks: StudioTask[]
  works: StudioWork[]
  workResults: StudioWorkResult[]
}

export interface StudioSessionWorkSnapshot {
  sessionId: string
  sessionEvents: StudioSessionEvent[]
  works: StudioWork[]
  workResults: StudioWorkResult[]
}
