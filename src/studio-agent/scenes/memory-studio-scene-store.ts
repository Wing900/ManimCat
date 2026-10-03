import type { StudioScene, StudioSceneAppendInput, StudioSceneStore } from '../domain/types'
import { StudioSceneOrderRejectedError } from './studio-scene-order-error'

/**
 * In-memory Scene store with the same observable behavior as the Supabase adapter.
 *
 * Every mutation body is synchronous, so a concurrent `append` can never observe a stale
 * "next position": the read of the current maximum and the write of the new record happen in
 * the same microtask, which is what makes the in-memory adapter atomic without a lock.
 */
export class InMemoryStudioSceneStore implements StudioSceneStore {
  private readonly scenes = new Map<string, StudioScene>()

  async create(scene: StudioScene): Promise<StudioScene> {
    if (this.scenes.has(scene.id)) {
      throw new Error('Studio scene already exists')
    }
    if (this.readSessionScenes(scene.ownerId, scene.sessionId).some((stored) => stored.position === scene.position)) {
      throw new Error('Studio scene position is already taken')
    }

    const stored: StudioScene = { ...scene }
    this.scenes.set(stored.id, stored)
    return { ...stored }
  }

  async append(scene: StudioSceneAppendInput): Promise<StudioScene> {
    if (this.scenes.has(scene.id)) {
      throw new Error('Studio scene already exists')
    }

    const stored: StudioScene = {
      ...scene,
      position: this.nextPosition(scene.ownerId, scene.sessionId)
    }
    this.scenes.set(stored.id, stored)
    return { ...stored }
  }

  async getById(ownerId: string, sceneId: string): Promise<StudioScene | null> {
    const scene = this.scenes.get(sceneId)
    return scene && scene.ownerId === ownerId ? { ...scene } : null
  }

  async listBySessionId(ownerId: string, sessionId: string): Promise<StudioScene[]> {
    return this.readSessionScenes(ownerId, sessionId)
  }

  async replaceOrder(
    ownerId: string,
    sessionId: string,
    orderedSceneIds: readonly string[]
  ): Promise<StudioScene[]> {
    const ordered = this.readSessionScenes(ownerId, sessionId)
    const submitted = [...orderedSceneIds]

    if (!submitted.length) {
      throw new StudioSceneOrderRejectedError('empty_order')
    }
    if (new Set(submitted).size !== submitted.length) {
      throw new StudioSceneOrderRejectedError('duplicate_scene')
    }
    if (submitted.length !== ordered.length) {
      throw new StudioSceneOrderRejectedError('incomplete_set')
    }

    const byId = new Map(ordered.map((scene) => [scene.id, scene]))
    const timestamp = new Date().toISOString()
    const next: StudioScene[] = []
    for (const [index, sceneId] of submitted.entries()) {
      const scene = byId.get(sceneId)
      if (!scene) {
        // Validation happens before the first write, so a rejected order never leaves a
        // half-renumbered Session behind.
        const foreign = this.scenes.get(sceneId)
        throw new StudioSceneOrderRejectedError(
          foreign && foreign.ownerId === ownerId ? 'foreign_scene' : 'missing_scene'
        )
      }
      next.push({ ...scene, position: index, updatedAt: timestamp })
    }

    for (const scene of next) {
      this.scenes.set(scene.id, scene)
    }
    return next.map((scene) => ({ ...scene }))
  }

  private readSessionScenes(ownerId: string, sessionId: string): StudioScene[] {
    return [...this.scenes.values()]
      .filter((scene) => scene.ownerId === ownerId && scene.sessionId === sessionId)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((scene) => ({ ...scene }))
  }

  private nextPosition(ownerId: string, sessionId: string): number {
    const positions = this.readSessionScenes(ownerId, sessionId).map((scene) => scene.position)
    return positions.length ? Math.max(...positions) + 1 : 0
  }
}
