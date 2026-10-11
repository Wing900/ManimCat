import assert from 'node:assert/strict'
import { createStudioSession } from '../../domain/factories'
import type { StudioScene } from '../../domain/core-types'
import { createInMemoryStudioPersistence } from '../../infrastructure/persistence/in-memory-studio-persistence'
import { withCachedStudioReads } from '../../infrastructure/persistence/cached-studio-reads'
import type { StudioPersistence } from '../../infrastructure/persistence/studio-persistence'
import { run } from './factories'

/**
 * The read cache that sits in front of the remote persistence provider. What matters is not that it
 * speeds reads up — that is the point of a cache — but that it can never serve a row this process has
 * already changed, and that two owners with the same id cannot see each other's rows.
 */
/** A complete Session record: the factory requires every field, and the ids are what the specs use. */
function sessionOf(overrides: { ownerId: string; title?: string }) {
  return createStudioSession({
    studioKind: 'manim',
    ownerId: overrides.ownerId,
    projectId: 'project-1',
    agentType: 'builder',
    title: overrides.title ?? 'Cached',
    directory: 'workspace-cached-reads',
  })
}

function sceneOf(overrides: Partial<StudioScene> = {}): StudioScene {
  return {
    id: 'scene-1',
    ownerId: 'owner-1',
    sessionId: 'session-1',
    position: 0,
    sourcePath: 'scenes/scene-1.py',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Counts the calls this cache is supposed to remove, and forwards everything else untouched.
 *
 * A spread copy would be the obvious way to do this and the wrong one: the providers are class
 * instances, so their methods live on the prototype and a spread silently drops them — the wrapper
 * keeps looking fine until someone calls a method that is no longer there. A Proxy has no copy, so
 * there is nothing to lose.
 */
function countingStore<T extends object>(store: T, counters: Partial<Record<keyof T, () => void>>): T {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') {
        return value
      }

      const method = value as (...args: unknown[]) => unknown
      const counter = typeof property === 'string' ? counters[property as keyof T] : undefined
      if (!counter) {
        return method.bind(target)
      }

      return (...args: unknown[]) => {
        counter()
        return method.apply(target, args)
      }
    },
  })
}

/** The in-memory provider, with the three reads this cache covers counted as they pass through. */
function createCountingPersistence() {
  const inner = createInMemoryStudioPersistence()
  const counts = { sessionReads: 0, sceneReads: 0, sceneLists: 0 }

  const persistence: StudioPersistence = {
    ...inner,
    sessionStore: countingStore(inner.sessionStore, {
      getById: () => {
        counts.sessionReads += 1
      },
    }),
    sceneStore: countingStore(inner.sceneStore, {
      getById: () => {
        counts.sceneReads += 1
      },
      listBySessionId: () => {
        counts.sceneLists += 1
      },
    }),
  }

  return { persistence, inner, counts }
}

export async function runCachedStudioReadsTests(): Promise<void> {
  await run('a Session read inside the window does not reach the provider again', async () => {
    const { persistence, inner, counts } = createCountingPersistence()
    const session = await inner.sessionStore.create(sessionOf({ ownerId: 'owner-1', title: 'Cached' }))
    let clock = 0
    const cached = withCachedStudioReads(persistence, { ttlMs: 1000, now: () => clock })

    const first = await cached.sessionStore.getById('owner-1', session.id)
    clock = 999
    const second = await cached.sessionStore.getById('owner-1', session.id)

    assert.equal(counts.sessionReads, 1)
    assert.deepEqual(second, first)
    assert.equal(second?.title, 'Cached')
  })

  await run('a Scene index read inside the window does not reach the provider again', async () => {
    const { persistence, inner, counts } = createCountingPersistence()
    await inner.sessionStore.create(sessionOf({ ownerId: 'owner-1' }))
    await inner.sceneStore.append(sceneOf({ ownerId: 'owner-1' }))
    const cached = withCachedStudioReads(persistence, { ttlMs: 60_000, now: () => 0 })

    const first = await cached.sceneStore.listBySessionId('owner-1', 'session-1')
    const second = await cached.sceneStore.listBySessionId('owner-1', 'session-1')

    assert.equal(counts.sceneLists, 1)
    assert.equal(first.length, 1)
    assert.deepEqual(second, first)
  })

  await run('a write this process made is never hidden by the cache', async () => {
    const { persistence, inner, counts } = createCountingPersistence()
    const session = await inner.sessionStore.create(sessionOf({ ownerId: 'owner-1', title: 'Before' }))
    const cached = withCachedStudioReads(persistence, { ttlMs: 60_000, now: () => 0 })

    assert.equal((await cached.sessionStore.getById('owner-1', session.id))?.title, 'Before')

    await cached.sessionStore.update('owner-1', session.id, { title: 'After' })

    assert.equal(counts.sessionReads, 1, 'the write must drop the entry, not update it in place')
    assert.equal((await cached.sessionStore.getById('owner-1', session.id))?.title, 'After')
  })

  await run('a Scene written after a read is visible immediately', async () => {
    const { persistence, inner } = createCountingPersistence()
    await inner.sessionStore.create(sessionOf({ ownerId: 'owner-1' }))
    const cached = withCachedStudioReads(persistence, { ttlMs: 60_000, now: () => 0 })

    assert.deepEqual(await cached.sceneStore.listBySessionId('owner-1', 'session-1'), [])
    const appended = await cached.sceneStore.append(sceneOf({ ownerId: 'owner-1' }))

    const listed = await cached.sceneStore.listBySessionId('owner-1', 'session-1')
    assert.deepEqual(
      listed.map((scene) => scene.id),
      [appended.id],
      'a cached empty index must not survive the append'
    )
    assert.equal((await cached.sceneStore.getById('owner-1', appended.id))?.id, appended.id)
  })

  await run('the window expiring sends the next read back to the provider', async () => {
    const { persistence, inner, counts } = createCountingPersistence()
    const session = await inner.sessionStore.create(sessionOf({ ownerId: 'owner-1' }))
    let clock = 0
    const cached = withCachedStudioReads(persistence, { ttlMs: 1000, now: () => clock })

    await cached.sessionStore.getById('owner-1', session.id)
    clock = 1001
    await cached.sessionStore.getById('owner-1', session.id)

    assert.equal(counts.sessionReads, 2)
  })

  await run('another owner reading the same id is never answered from the first entry', async () => {
    const { persistence, inner, counts } = createCountingPersistence()
    const scene = await inner.sceneStore.append(sceneOf({ ownerId: 'owner-1' }))
    const cached = withCachedStudioReads(persistence, { ttlMs: 60_000, now: () => 0 })

    const mine = await cached.sceneStore.getById('owner-1', scene.id)
    const theirs = await cached.sceneStore.getById('owner-2', scene.id)

    assert.equal(mine?.id, scene.id)
    assert.equal(theirs, null, 'owner-1 cached entry must not answer for owner-2')
    assert.equal(counts.sceneReads, 2, 'the lookup under another owner must reach the provider')
  })

  await run('a row that does not exist is never remembered', async () => {
    const { persistence, counts } = createCountingPersistence()
    const cached = withCachedStudioReads(persistence, { ttlMs: 60_000, now: () => 0 })

    assert.equal(await cached.sessionStore.getById('owner-1', 'missing'), null)
    assert.equal(await cached.sessionStore.getById('owner-1', 'missing'), null)

    assert.equal(counts.sessionReads, 2, 'a null must not be cached: a Session created moments later would look absent')
  })
}
