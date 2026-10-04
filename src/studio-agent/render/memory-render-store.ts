import type {
  StudioRender,
  StudioRenderStore,
  StudioRenderTransitionInput,
  StudioRenderTransitionResult,
} from '../domain/types'
import { canTransitionStudioRenderStatus } from './render-status-transitions'

export class InMemoryStudioRenderStore implements StudioRenderStore {
  private readonly renders = new Map<string, StudioRender>()

  /**
   * The in-memory schema has no foreign keys, so Postgres' `on delete cascade` is wired here instead:
   * the persistence factory subscribes this to the Session store's delete. Deliberately not part of the
   * store contract — the Supabase adapter leaves the cascade to the database.
   */
  deleteBySessionId(sessionId: string): void {
    for (const [id, render] of this.renders) {
      if (render.sessionId === sessionId) {
        this.renders.delete(id)
      }
    }
  }

  async create(render: StudioRender): Promise<StudioRender> {
    this.renders.set(render.id, render)
    return render
  }

  async getById(ownerId: string, renderId: string): Promise<StudioRender | null> {
    const render = this.renders.get(renderId)
    return render?.ownerId === ownerId ? render : null
  }

  async update(ownerId: string, renderId: string, patch: Partial<StudioRender>): Promise<StudioRender | null> {
    const current = await this.getById(ownerId, renderId)
    if (!current) {
      return null
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    this.renders.set(renderId, next)
    return next
  }

  async transitionStatus(input: StudioRenderTransitionInput): Promise<StudioRenderTransitionResult> {
    const current = this.renders.get(input.renderId)
    if (!current || current.ownerId !== input.ownerId) {
      return { applied: false, render: null }
    }

    // Guarded here as well as in Supabase: an illegal target (a backward move) or a stale `from`
    // list never mutates the stored render, and a job id that no longer matches refuses the write.
    if (
      !canTransitionStudioRenderStatus(input.from, input.patch.status) ||
      !input.from.includes(current.status) ||
      (input.expectedJobId !== undefined && input.expectedJobId !== current.jobId)
    ) {
      return { applied: false, render: current }
    }

    const next: StudioRender = { ...current, ...input.patch, updatedAt: new Date().toISOString() }
    this.renders.set(input.renderId, next)
    return { applied: true, render: next }
  }

  async listBySessionId(ownerId: string, sessionId: string): Promise<StudioRender[]> {
    return [...this.renders.values()]
      .filter((render) => render.ownerId === ownerId && render.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async listBySceneId(ownerId: string, sceneId: string): Promise<StudioRender[]> {
    return [...this.renders.values()]
      .filter((render) => render.ownerId === ownerId && render.sceneId === sceneId)
      .sort(compareByCreatedAtThenId)
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
