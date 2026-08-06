import type {
  StudioMessageStore,
  StudioPartStore,
  StudioRunStore,
  StudioRenderStore,
  StudioSessionEventStore,
  StudioSessionStore,
  StudioTaskStore,
  StudioWorkResultStore,
  StudioWorkStore,
} from '../domain/types'

export interface StudioPersistence {
  sessionStore: StudioSessionStore
  messageStore: StudioMessageStore
  partStore: StudioPartStore
  runStore: StudioRunStore
  renderStore: StudioRenderStore
  taskStore: StudioTaskStore
  workStore: StudioWorkStore
  workResultStore: StudioWorkResultStore
  sessionEventStore: StudioSessionEventStore
}
