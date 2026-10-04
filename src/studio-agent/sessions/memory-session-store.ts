import type { StudioSession, StudioSessionStore } from '../domain/types'

export class InMemoryStudioSessionStore implements StudioSessionStore {
  private readonly sessions = new Map<string, StudioSession>()
  /**
   * The rows that point at a Session, as removal steps. Postgres cascades them from the foreign keys;
   * an in-memory store has none, so the persistence factory wires the same cascade here.
   */
  private readonly cascade: Array<(sessionId: string) => void> = []

  /** Registers one cascade step. Not part of the store contract: only the in-memory factory uses it. */
  onDelete(listener: (sessionId: string) => void): void {
    this.cascade.push(listener)
  }

  async create(session: StudioSession): Promise<StudioSession> {
    this.sessions.set(session.id, session)
    return session
  }

  async getById(ownerId: string, sessionId: string): Promise<StudioSession | null> {
    const session = this.sessions.get(sessionId)
    return session?.ownerId === ownerId ? session : null
  }

  async update(ownerId: string, sessionId: string, patch: Partial<StudioSession>): Promise<StudioSession | null> {
    const current = this.sessions.get(sessionId)
    if (!current || current.ownerId !== ownerId) {
      return null
    }

    const next: StudioSession = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    this.sessions.set(sessionId, next)
    return next
  }

  async listChildren(ownerId: string, parentSessionId: string): Promise<StudioSession[]> {
    return [...this.sessions.values()].filter((session) => (
      session.ownerId === ownerId && session.parentSessionId === parentSessionId
    ))
  }

  async delete(ownerId: string, sessionId: string): Promise<boolean> {
    const current = this.sessions.get(sessionId)
    if (!current || current.ownerId !== ownerId) {
      return false
    }
    this.sessions.delete(sessionId)
    for (const step of this.cascade) {
      step(sessionId)
    }
    return true
  }
}
