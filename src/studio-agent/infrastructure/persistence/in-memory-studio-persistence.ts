import type { StudioPersistence } from './studio-persistence'
import { InMemoryStudioRunStore } from '../../runs/memory-run-store'
import { InMemoryStudioMessageStore } from '../../sessions/memory-message-store'
import { InMemoryStudioPartStore } from '../../sessions/memory-part-store'
import { InMemoryStudioSessionStore } from '../../sessions/memory-session-store'
import { InMemoryStudioRenderStore } from '../../render/memory-render-store'
import { InMemoryStudioSceneStore } from '../../scenes/memory-studio-scene-store'

export function createInMemoryStudioPersistence(): StudioPersistence {
  const sessionStore = new InMemoryStudioSessionStore()
  const messageStore = new InMemoryStudioMessageStore()
  const partStore = new InMemoryStudioPartStore()
  const runStore = new InMemoryStudioRunStore()
  const renderStore = new InMemoryStudioRenderStore()
  const sceneStore = new InMemoryStudioSceneStore()

  // Postgres removes every row that points at a Session when the Session row goes. These stores have no
  // foreign keys, so the same cascade is wired here — in one place, and only for this persistence.
  sessionStore.onDelete((sessionId) => {
    messageStore.deleteBySessionId(sessionId)
    partStore.deleteBySessionId(sessionId)
    runStore.deleteBySessionId(sessionId)
    renderStore.deleteBySessionId(sessionId)
    sceneStore.deleteBySessionId(sessionId)
  })

  return { sessionStore, messageStore, partStore, runStore, renderStore, sceneStore }
}
