import type {
  StudioMessageStore,
  StudioPartStore,
  StudioRunStore,
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
  taskStore: StudioTaskStore
  workStore: StudioWorkStore
  workResultStore: StudioWorkResultStore
}
