import type { StudioPersistence } from './studio-persistence'
import { InMemoryStudioRunStore } from '../runs/memory-run-store'
import { InMemoryStudioMessageStore } from '../sessions/memory-message-store'
import { InMemoryStudioPartStore } from '../sessions/memory-part-store'
import { InMemoryStudioSessionStore } from '../sessions/memory-session-store'
import { InMemoryStudioRenderStore } from '../render/memory-render-store'

export function createInMemoryStudioPersistence(): StudioPersistence {
  return {
    sessionStore: new InMemoryStudioSessionStore(),
    messageStore: new InMemoryStudioMessageStore(),
    partStore: new InMemoryStudioPartStore(),
    runStore: new InMemoryStudioRunStore(),
    renderStore: new InMemoryStudioRenderStore(),
  }
}
