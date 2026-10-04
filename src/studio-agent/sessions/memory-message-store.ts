import type {
  StudioAssistantMessage,
  StudioMessage,
  StudioMessageStore,
  StudioUserMessage
} from '../domain/types'

export class InMemoryStudioMessageStore implements StudioMessageStore {
  private readonly messages = new Map<string, StudioMessage>()

  /**
   * The in-memory schema has no foreign keys, so Postgres' `on delete cascade` is wired here instead:
   * the persistence factory subscribes this to the Session store's delete. Deliberately not part of the
   * store contract — the Supabase adapter leaves the cascade to the database.
   */
  deleteBySessionId(sessionId: string): void {
    for (const [id, message] of this.messages) {
      if (message.sessionId === sessionId) {
        this.messages.delete(id)
      }
    }
  }

  async createAssistantMessage(message: StudioAssistantMessage): Promise<StudioAssistantMessage> {
    this.messages.set(message.id, message)
    return message
  }

  async createUserMessage(message: StudioUserMessage): Promise<StudioUserMessage> {
    this.messages.set(message.id, message)
    return message
  }

  async getById(messageId: string): Promise<StudioMessage | null> {
    return this.messages.get(messageId) ?? null
  }

  async listBySessionId(sessionId: string): Promise<StudioMessage[]> {
    return [...this.messages.values()].filter((message) => message.sessionId === sessionId)
  }

  async listBySceneId(sceneId: string): Promise<StudioMessage[]> {
    return [...this.messages.values()]
      .filter((message) => message.sceneId === sceneId)
      .sort(compareByCreatedAtThenId)
  }

  async updateAssistantMessage(
    messageId: string,
    patch: Partial<Omit<StudioAssistantMessage, 'id' | 'sessionId' | 'role'>>
  ): Promise<StudioAssistantMessage | null> {
    const current = this.messages.get(messageId)
    if (!current || current.role !== 'assistant') {
      return null
    }

    const next: StudioAssistantMessage = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    }

    this.messages.set(messageId, next)
    return next
  }
}

/** Deterministic order shared by every Scene-scoped query: creation time, then id. */
function compareByCreatedAtThenId(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
  return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id)
}

