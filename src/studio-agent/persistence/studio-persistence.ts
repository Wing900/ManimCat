import type {
  StudioMessageStore,
  StudioPartStore,
  StudioRunStore,
  StudioRenderStore,
  StudioSessionStore,
} from '../domain/types'

export interface StudioPersistence {
  sessionStore: StudioSessionStore
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore: StudioRunStore
  renderStore: StudioRenderStore
}
