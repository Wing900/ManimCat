import type { StudioAgentEvent, StudioEventBus } from '../../domain/types'

export class RecordingEventBus implements StudioEventBus {
  readonly events: StudioAgentEvent[] = []
  private readonly listeners = new Map<string, Set<(event: StudioAgentEvent) => void>>()

  publish(event: StudioAgentEvent): void {
    this.events.push(event)
    for (const listener of this.listeners.get(event.type === 'run_updated' ? event.sessionId : event.sessionId) ?? []) {
      listener(event)
    }
  }

  subscribe(sessionId: string, listener: (event: StudioAgentEvent) => void): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<(event: StudioAgentEvent) => void>()
    listeners.add(listener)
    this.listeners.set(sessionId, listeners)
    return () => listeners.delete(listener)
  }
}
