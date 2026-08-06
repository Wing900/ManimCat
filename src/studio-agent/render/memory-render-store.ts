import type { StudioRender, StudioRenderStore } from '../domain/types'

export class InMemoryStudioRenderStore implements StudioRenderStore {
  private readonly renders = new Map<string, StudioRender>()

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

  async listBySessionId(ownerId: string, sessionId: string): Promise<StudioRender[]> {
    return [...this.renders.values()]
      .filter((render) => render.ownerId === ownerId && render.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }
}
