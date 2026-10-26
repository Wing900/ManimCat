import { decodeStudioCinemaSceneEvent } from '../cinema/scene-events'
import { applySceneEvent, createSceneState } from '../cinema/scene-state'
import type { StudioExternalEvent } from '../protocol/studio-agent-events'
import type { StudioScene, StudioSceneMessage } from '../protocol/studio-agent-types'
import type { LocalStudioStore } from './local-studio-store'

/**
 * Durable conversation journal.
 *
 * Message writes are serialized per Session, so a streamed event never lands before the snapshot or
 * accepted message it follows. The reduction itself is the Cinema's own `applySceneEvent`, not a
 * second, hand-written reading of the event: the UI and IndexedDB therefore cannot drift.
 */
export interface LocalConversationJournal {
  append(message: StudioSceneMessage): Promise<void>
  /** Upsert inside the Session queue; `merge` reads the row that is durable at execution time. */
  update(
    message: StudioSceneMessage,
    merge?: (next: StudioSceneMessage, current: StudioSceneMessage) => StudioSceneMessage,
  ): Promise<void>
  applyEvent(sessionId: string, sceneId: string, event: StudioExternalEvent): Promise<void>
  /** Resolves once every write queued so far for this Session is durable. */
  drain(sessionId: string): Promise<void>
}

export function createLocalConversationJournal(
  store: LocalStudioStore,
  onError: (error: unknown) => void = error => console.error('Local conversation journal failed', error),
): LocalConversationJournal {
  const queues = new Map<string, Promise<void>>()

  function enqueue(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const previous = queues.get(sessionId) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(operation)
    queues.set(sessionId, pending)
    void pending.finally(() => {
      if (queues.get(sessionId) === pending) queues.delete(sessionId)
    }).catch(onError)
    return pending
  }

  function append(message: StudioSceneMessage): Promise<void> {
    return enqueue(message.sessionId, () => store.appendMessage(message))
  }

  function update(
    message: StudioSceneMessage,
    merge?: (next: StudioSceneMessage, current: StudioSceneMessage) => StudioSceneMessage,
  ): Promise<void> {
    return enqueue(message.sessionId, async () => {
      const messages = await store.listSessionMessages(message.sessionId)
      const current = messages.find(candidate => candidate.id === message.id)
      await store.appendMessage(current && merge ? merge(message, current) : message)
    })
  }

  function applyEvent(sessionId: string, sceneId: string, external: StudioExternalEvent): Promise<void> {
    const decoded = decodeStudioCinemaSceneEvent(external)
    if (!decoded || !decoded.identity || decoded.identity.sessionId !== sessionId) {
      return Promise.resolve()
    }
    const event = decoded.event
    if (
      event.kind !== 'assistant-text'
      && event.kind !== 'tool-input-start'
      && event.kind !== 'tool-call'
      && event.kind !== 'tool-result'
    ) {
      return Promise.resolve()
    }

    return enqueue(sessionId, async () => {
      const messages = await store.listMessages(sessionId, sceneId)
      const scene: StudioScene = await store.getScene(sessionId, sceneId) ?? {
        id: sceneId,
        sessionId,
        position: 0,
        createdAt: messages[0]?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const state = { ...createSceneState(decoded.identity!, scene), messages }
      const before = messages.find(message => message.id === event.messageId)
      const next = applySceneEvent(state, event, Date.now())
      const changed = next.messages.find(message => message.id === event.messageId)
      if (!changed || changed === before) return
      await store.appendMessage(changed)
    })
  }

  function drain(sessionId: string): Promise<void> {
    return (queues.get(sessionId) ?? Promise.resolve()).catch(() => {})
  }

  return { append, update, applyEvent, drain }
}
