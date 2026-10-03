import type {
  StudioMessageStore,
  StudioPartStore,
  StudioRunStore,
  StudioRenderStore,
  StudioSceneStore,
  StudioSessionStore,
} from '../domain/types'

export interface StudioPersistence {
  sessionStore: StudioSessionStore
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore: StudioRunStore
  renderStore: StudioRenderStore
  sceneStore: StudioSceneStore
}
