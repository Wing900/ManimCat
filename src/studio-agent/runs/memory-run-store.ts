import type { StudioRun, StudioRunStore, StudioRunTransitionInput, StudioRunTransitionResult } from '../domain/types'
import { canTransitionStudioRunStatus } from './run-status-transitions'

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

  async transitionStatus(input: StudioRunTransitionInput): Promise<StudioRunTransitionResult> {
    const current = this.runs.get(input.runId)
    if (!current || current.ownerId !== input.ownerId) {
      return { applied: false, run: null }
    }

    // Guarded here as well as in Supabase: an illegal target (for example back to
    // `running`) or a stale `from` list never mutates the stored Run.
    if (!canTransitionStudioRunStatus(input.from, input.patch.status) || !input.from.includes(current.status)) {
      return { applied: false, run: current }
    }

    const next: StudioRun = { ...current, ...input.patch }
    this.runs.set(input.runId, next)
    return { applied: true, run: next }
  }

  async listBySessionId(ownerId: string, sessionId: string): Promise<StudioRun[]> {
    return [...this.runs.values()].filter((run) => run.ownerId === ownerId && run.sessionId === sessionId)
  }
}
