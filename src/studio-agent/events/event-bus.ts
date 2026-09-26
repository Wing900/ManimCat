import type { StudioAgentEvent, StudioEventBus } from '../domain/types'

export type StudioEventListener = (event: StudioAgentEvent) => void

export class InMemoryStudioEventBus implements StudioEventBus {
  private readonly listenersBySession = new Map<string, Set<StudioEventListener>>()

  publish(event: StudioAgentEvent): void {
    for (const listener of this.listenersBySession.get(event.sessionId) ?? []) {
      listener(event)
    }
  }

  subscribe(sessionId: string, listener: StudioEventListener): () => void {
    const listeners = this.listenersBySession.get(sessionId) ?? new Set<StudioEventListener>()
    listeners.add(listener)
    this.listenersBySession.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listenersBySession.delete(sessionId)
      }
    }
  }
}
