import type { StudioSceneStore, StudioSessionStore } from '../../domain/types'
import type { StudioPersistence } from './studio-persistence'

/**
 * How long a Session or Scene row may be reused when nothing in this process has written since.
 *
 * Every write through these two stores clears the cache, so this window only covers what this process
 * cannot see: a second instance, or a row edited by hand in SQL. Writes to the *other* stores do not
 * clear it, and must not: a streaming message does not change which Session exists or where a Scene
 * sits, and clearing on every token would leave the cache permanently empty.
 */
export const STUDIO_STORE_CACHE_TTL_MS = 30_000

/**
 * Caches the two row reads a Scene snapshot always starts with — the Session, then the Scene — which
 * are otherwise two sequential Supabase round trips before the messages, Runs and renders can even be
 * requested. Those three stay uncached on purpose: they are the content on screen, they change while a
 * Run streams, and they are already fetched as one parallel batch.
 *
 * Only a found row is remembered. A miss re-queries, so a row this process just created can never look
 * absent because an earlier lookup found nothing.
 */
export function withCachedStudioReads(
  persistence: StudioPersistence,
  options: { ttlMs?: number; now?: () => number } = {},
): StudioPersistence {
  const ttlMs = options.ttlMs ?? STUDIO_STORE_CACHE_TTL_MS
  const now = options.now ?? (() => Date.now())
  const rows = new Map<string, { value: unknown; expiresAt: number }>()

  /** Dropped on both sides of a write: before, so the write cannot land under a stale read; after, so
   * a read that raced it cannot leave the pre-write row behind. */
  function forget(): void {
    rows.clear()
  }

  function readRow<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const current = now()
    const remembered = rows.get(key)
    if (remembered && remembered.expiresAt > current) {
      return Promise.resolve(remembered.value as T)
    }

    return load().then((value) => {
      if (value) {
        rows.set(key, { value, expiresAt: current + ttlMs })
      } else {
        rows.delete(key)
      }
      return value
    })
  }

  /** The list form of the same rule: an empty list is an absence, so it is not remembered either. */
  function readList<T>(key: string, load: () => Promise<T[]>): Promise<T[]> {
    const current = now()
    const remembered = rows.get(key)
    if (remembered && remembered.expiresAt > current) {
      return Promise.resolve(remembered.value as T[])
    }

    return load().then((value) => {
      if (value.length > 0) {
        rows.set(key, { value, expiresAt: current + ttlMs })
      } else {
        rows.delete(key)
      }
      return value
    })
  }

  const sessionStore: StudioSessionStore = {
    async create(session) {
      forget()
      const stored = await persistence.sessionStore.create(session)
      forget()
      return stored
    },
    getById: (ownerId, sessionId) =>
      readRow(`session:${ownerId}:${sessionId}`, () => persistence.sessionStore.getById(ownerId, sessionId)),
    async update(ownerId, sessionId, patch) {
      forget()
      const stored = await persistence.sessionStore.update(ownerId, sessionId, patch)
      forget()
      return stored
    },
    listChildren: (ownerId, parentSessionId) =>
      persistence.sessionStore.listChildren(ownerId, parentSessionId),
    async delete(ownerId, sessionId) {
      forget()
      const removed = await persistence.sessionStore.delete(ownerId, sessionId)
      forget()
      return removed
    },
  }

  const sceneStore: StudioSceneStore = {
    async create(scene) {
      forget()
      const stored = await persistence.sceneStore.create(scene)
      forget()
      return stored
    },
    async append(scene) {
      forget()
      const stored = await persistence.sceneStore.append(scene)
      forget()
      return stored
    },
    getById: (ownerId, sceneId) =>
      readRow(`scene:${ownerId}:${sceneId}`, () => persistence.sceneStore.getById(ownerId, sceneId)),
    listBySessionId: (ownerId, sessionId) =>
      readList(`scenes:${ownerId}:${sessionId}`, () => persistence.sceneStore.listBySessionId(ownerId, sessionId)),
    async replaceOrder(ownerId, sessionId, orderedSceneIds) {
      forget()
      const stored = await persistence.sceneStore.replaceOrder(ownerId, sessionId, orderedSceneIds)
      forget()
      return stored
    },
  }

  return { ...persistence, sessionStore, sceneStore }
}
