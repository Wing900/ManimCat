import type {
  StudioSession,
  StudioPartStore,
  StudioMessageStore,
  StudioSessionStore,
  StudioToolContext
} from '../../domain/types'

export interface StudioRunExecutionResult {
  text: string
}

export interface StudioRuntimeBackedToolContext extends StudioToolContext {
  partStore?: StudioPartStore
  messageStore?: StudioMessageStore
  sessionStore?: StudioSessionStore
}