import type { StudioConversationScope } from '../../domain/conversation-buffer'
import type { StudioMessage, StudioMessagePart, StudioMessageStore, StudioPartStore } from '../../domain/types'
import type { StudioPersistence } from './studio-persistence'

interface LiveConversation {
  scope: StudioConversationScope
  messages: Map<string, StudioMessage>
  parts: Map<string, StudioMessagePart>
  active: boolean
  flushing?: Promise<void>
}

/** Read-through history + Run-owned write buffer. No per-token remote writes. */
export function withBufferedStudioConversations(persistence: StudioPersistence): StudioPersistence {
  if (persistence.conversationBuffer) return persistence
  const conversations = new Map<string, LiveConversation>()
  const messageOwners = new Map<string, LiveConversation>()
  const partOwners = new Map<string, LiveConversation>()
  const key = (scope: StudioConversationScope) => JSON.stringify([scope.sessionId, scope.sceneId ?? null])

  function release(live: LiveConversation): void {
    for (const id of live.messages.keys()) messageOwners.delete(id)
    for (const id of live.parts.keys()) partOwners.delete(id)
    conversations.delete(key(live.scope))
  }

  function stage<T extends StudioMessage>(message: T): T | null {
    const live = conversations.get(key(message))
    if (!live) return null
    live.messages.set(message.id, message)
    messageOwners.set(message.id, live)
    if (message.role === 'assistant') {
      for (const part of message.parts) {
        live.parts.set(part.id, part)
        partOwners.set(part.id, live)
      }
    }
    return message
  }

  function merge(history: StudioMessage[], predicate: (message: StudioMessage) => boolean, reading: LiveConversation[]): StudioMessage[] {
    const records = new Map(history.map(message => [message.id, message]))
    // A flush may finish while the durable read is in flight. Keep its live references until
    // this read completes, so releasing the buffer cannot make an earlier DB snapshot lose a turn.
    for (const live of new Set([...reading, ...conversations.values()])) {
      for (const message of live.messages.values()) {
        if (predicate(message)) records.set(message.id, structuredClone(message))
      }
    }
    return [...records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  async function readHistory(load: () => Promise<StudioMessage[]>, predicate: (message: StudioMessage) => boolean) {
    const reading = [...conversations.values()]
    return merge(await load(), predicate, reading)
  }

  const messageStore: StudioMessageStore = {
    createUserMessage: async message => stage(message) ?? persistence.messageStore.createUserMessage(message),
    createAssistantMessage: async message => stage(message) ?? persistence.messageStore.createAssistantMessage(message),
    getById: async id => {
      const message = messageOwners.get(id)?.messages.get(id)
      return message ? structuredClone(message) : persistence.messageStore.getById(id)
    },
    listBySessionId: sessionId => readHistory(
      () => persistence.messageStore.listBySessionId(sessionId), message => message.sessionId === sessionId),
    listBySceneId: sceneId => readHistory(
      () => persistence.messageStore.listBySceneId(sceneId), message => message.sceneId === sceneId),
    updateAssistantMessage: async (id, patch) => {
      const live = messageOwners.get(id)
      const current = live?.messages.get(id)
      if (!live || !current || current.role !== 'assistant') {
        return persistence.messageStore.updateAssistantMessage(id, patch)
      }
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
      live.messages.set(id, next)
      return structuredClone(next)
    },
  }
  const partStore: StudioPartStore = {
    create: async part => {
      const live = messageOwners.get(part.messageId)
      if (!live) return persistence.partStore.create(part)
      live.parts.set(part.id, part)
      partOwners.set(part.id, live)
      return part
    },
    getById: async id => {
      const part = partOwners.get(id)?.parts.get(id)
      return part ? structuredClone(part) : persistence.partStore.getById(id)
    },
    listByMessageId: async id => {
      const live = messageOwners.get(id)
      return live
        ? structuredClone([...live.parts.values()].filter(part => part.messageId === id))
        : persistence.partStore.listByMessageId(id)
    },
    update: async (id, patch) => {
      const live = partOwners.get(id)
      const current = live?.parts.get(id)
      if (!live || !current) return persistence.partStore.update(id, patch)
      const next = { ...current, ...patch } as StudioMessagePart
      live.parts.set(id, next)
      return structuredClone(next)
    },
  }

  async function save(live: LiveConversation): Promise<void> {
    live.active = false
    const messages = [...live.messages.values()].map(message => message.role === 'assistant'
      ? { ...message, parts: [...live.parts.values()].filter(part => part.messageId === message.id) }
      : message)
    if (persistence.conversationWriter) {
      await persistence.conversationWriter(messages)
    } else {
      for (const message of messages) {
        if (message.role === 'user') await persistence.messageStore.createUserMessage(message)
        else {
          await persistence.messageStore.createAssistantMessage(message)
          for (const part of message.parts) await persistence.partStore.create(part)
        }
      }
    }
    // Keep live data available to reconnecting clients until both writes have completed.
    release(live)
  }

  return {
    ...persistence,
    messageStore,
    partStore,
    sessionStore: {
      create: session => persistence.sessionStore.create(session),
      getById: (ownerId, sessionId) => persistence.sessionStore.getById(ownerId, sessionId),
      update: (ownerId, sessionId, patch) => persistence.sessionStore.update(ownerId, sessionId, patch),
      listChildren: (ownerId, sessionId) => persistence.sessionStore.listChildren(ownerId, sessionId),
      delete: async (ownerId, sessionId) => {
        const removed = await persistence.sessionStore.delete(ownerId, sessionId)
        if (removed) for (const live of conversations.values()) {
          if (live.scope.sessionId === sessionId) release(live)
        }
        return removed
      },
    },
    conversationBuffer: {
      async begin(scope) {
        const previous = conversations.get(key(scope))
        if (previous?.active) throw new Error('Conversation still active')
        // Retry a failed final save before accepting another turn; no silent overwrite/loss.
        if (previous) await this.flush(scope)
        conversations.set(key(scope), { scope, messages: new Map(), parts: new Map(), active: true })
      },
      async flush(scope) {
        const live = conversations.get(key(scope))
        if (!live) return
        if (!live.flushing) live.flushing = save(live).catch(error => {
          live.flushing = undefined
          throw error
        })
        await live.flushing
      },
    },
  }
}
