import type {
  StudioMessageStore,
  StudioPartStore,
  StudioRunStore,
  StudioRenderStore,
  StudioSceneStore,
  StudioSessionStore,
} from '../../domain/types'
import type { StudioConversationBuffer, StudioConversationWriter } from '../../domain/conversation-buffer'

export interface StudioPersistence {
  conversationWriter?: StudioConversationWriter
  conversationBuffer?: StudioConversationBuffer
  sessionStore: StudioSessionStore
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore: StudioRunStore
  renderStore: StudioRenderStore
  sceneStore: StudioSceneStore
}
