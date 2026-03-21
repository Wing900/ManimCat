import type { StudioPersistence } from './studio-persistence'
import { InMemoryStudioRunStore } from '../runs/memory-run-store'
import { InMemoryStudioMessageStore } from '../sessions/memory-message-store'
import { InMemoryStudioPartStore } from '../sessions/memory-part-store'
import { InMemoryStudioSessionStore } from '../sessions/memory-session-store'
import { InMemoryStudioTaskStore } from '../tasks/memory-task-store'
import { InMemoryStudioWorkResultStore } from '../works/memory-work-result-store'
import { InMemoryStudioWorkStore } from '../works/memory-work-store'

export function createInMemoryStudioPersistence(): StudioPersistence {
  return {
    sessionStore: new InMemoryStudioSessionStore(),
    messageStore: new InMemoryStudioMessageStore(),
    partStore: new InMemoryStudioPartStore(),
    runStore: new InMemoryStudioRunStore(),
    taskStore: new InMemoryStudioTaskStore(),
    workStore: new InMemoryStudioWorkStore(),
    workResultStore: new InMemoryStudioWorkResultStore(),
  }
}
