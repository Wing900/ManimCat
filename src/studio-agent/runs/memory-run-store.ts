import type { StudioRun, StudioRunStore } from '../domain/types'

export class InMemoryStudioRunStore implements StudioRunStore {
  private readonly runs = new Map<string, StudioRun>()

  async create(run: StudioRun): Promise<StudioRun> {
    this.runs.set(run.id, run)
    return run
  }

  async getById(ownerId: string, runId: string): Promise<StudioRun | null> {
    const run = this.runs.get(runId)
    return run?.ownerId === ownerId ? run : null
  }

  async update(ownerId: string, runId: string, patch: Partial<StudioRun>): Promise<StudioRun | null> {
    const current = this.runs.get(runId)
    if (!current || current.ownerId !== ownerId) {
      return null
    }

    const next: StudioRun = {
      ...current,
      ...patch
    }
    this.runs.set(runId, next)
    return next
  }

  async listBySessionId(ownerId: string, sessionId: string): Promise<StudioRun[]> {
    return [...this.runs.values()].filter((run) => run.ownerId === ownerId && run.sessionId === sessionId)
  }
}
