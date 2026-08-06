import type { StudioSession, StudioSessionStore } from '../domain/types'

export class InMemoryStudioSessionStore implements StudioSessionStore {
  private readonly sessions = new Map<string, StudioSession>()

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
}
