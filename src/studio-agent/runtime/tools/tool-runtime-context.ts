import type {
  StudioSession,
  StudioPartStore,
  StudioMessageStore,
  StudioSessionStore,
  StudioRenderStore,
  StudioToolContext
} from '../../domain/types'

export interface StudioRunExecutionResult {
  text: string
}

export interface StudioRuntimeBackedToolContext extends StudioToolContext {
  partStore?: StudioPartStore
  messageStore?: StudioMessageStore
  sessionStore?: StudioSessionStore
  renderStore?: StudioRenderStore
}
