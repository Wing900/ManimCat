import assert from 'node:assert/strict'
import { run } from '../support/fakes'
import {
  DEFAULT_CAT_KEY_CACHE_TTL_MS,
  createCachedCatKeyRepository,
  readCatKeyCacheTtlMs,
} from '../../infrastructure/cached-cat-key-repository'
import type { CatKeyRepository } from '../../application/ports/cat-key-repository'
import type { CatKeyRecord } from '../../domain/cat-key'

function recordOf(overrides: Partial<CatKeyRecord> = {}): CatKeyRecord {
  return {
    id: 'key-1',
    keyHash: 'hash-1',
    keyPrefix: 'mc_a1b2c3d4',
    label: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  }
}

/** A repository that serves a scripted answer and counts how often it was actually asked. */
function createSpyRepository(answer: () => CatKeyRecord | undefined) {
  const calls = { findByHash: 0, touchLastUsedAt: [] as Array<{ catKeyId: string; usedAt: Date }> }

  const repository: CatKeyRepository = {
    async findByHash() {
      calls.findByHash += 1
      return answer()
    },
    async touchLastUsedAt(catKeyId, usedAt) {
      calls.touchLastUsedAt.push({ catKeyId, usedAt })
    },
  }

  return { repository, calls }
}

export async function runCachedCatKeyRepositoryTests(): Promise<void> {
  await run('a resolved key is asked for once inside the window', async () => {
    const { repository, calls } = createSpyRepository(() => recordOf())
    let clock = 0
    const cached = createCachedCatKeyRepository(repository, { ttlMs: 1000, now: () => clock })

    const first = await cached.findByHash('hash-1')
    clock = 999
    const second = await cached.findByHash('hash-1')

    assert.equal(calls.findByHash, 1, 'the second read must come from the cache')
    assert.deepEqual(second, first)
    assert.equal(second?.id, 'key-1')
  })

  await run('the window expiring sends the next read back to the registry', async () => {
    const { repository, calls } = createSpyRepository(() => recordOf())
    let clock = 0
    const cached = createCachedCatKeyRepository(repository, { ttlMs: 1000, now: () => clock })

    await cached.findByHash('hash-1')
    clock = 1001
    await cached.findByHash('hash-1')

    assert.equal(calls.findByHash, 2)
  })

  await run('a key that does not exist is never remembered', async () => {
    const { repository, calls } = createSpyRepository(() => undefined)
    const cached = createCachedCatKeyRepository(repository, { ttlMs: 60_000, now: () => 0 })

    assert.equal(await cached.findByHash('missing'), undefined)
    assert.equal(await cached.findByHash('missing'), undefined)

    assert.equal(calls.findByHash, 2, 'a miss must not be cached: a newly issued key would fail until it expired')
  })

  await run('a key revoked mid-window keeps working only until that window ends', async () => {
    let status: CatKeyRecord['status'] = 'active'
    const { repository, calls } = createSpyRepository(() => recordOf({ status }))
    let clock = 0
    const cached = createCachedCatKeyRepository(repository, { ttlMs: 1000, now: () => clock })

    const whileActive = await cached.findByHash('hash-1')
    status = 'revoked'

    // The documented cost of the window: the cache is the only thing that knew it was active.
    clock = 500
    assert.equal((await cached.findByHash('hash-1'))?.status, 'active')
    assert.equal(calls.findByHash, 1)

    clock = 1001
    assert.equal((await cached.findByHash('hash-1'))?.status, 'revoked')
    assert.equal(whileActive?.status, 'active')
  })

  await run('the usage bookkeeping is passed straight through', async () => {
    const { repository, calls } = createSpyRepository(() => recordOf())
    const cached = createCachedCatKeyRepository(repository, { ttlMs: 1000, now: () => 0 })
    const usedAt = new Date('2026-01-01T00:00:00.000Z')

    await cached.touchLastUsedAt('key-1', usedAt)

    assert.deepEqual(calls.touchLastUsedAt, [{ catKeyId: 'key-1', usedAt }])
  })

  await run('an unusable configured window falls back to the default', async () => {
    assert.equal(readCatKeyCacheTtlMs(undefined), DEFAULT_CAT_KEY_CACHE_TTL_MS)
    assert.equal(readCatKeyCacheTtlMs(''), DEFAULT_CAT_KEY_CACHE_TTL_MS)
    assert.equal(readCatKeyCacheTtlMs('   '), DEFAULT_CAT_KEY_CACHE_TTL_MS)
    assert.equal(readCatKeyCacheTtlMs('0'), DEFAULT_CAT_KEY_CACHE_TTL_MS)
    assert.equal(readCatKeyCacheTtlMs('-5'), DEFAULT_CAT_KEY_CACHE_TTL_MS)
    assert.equal(readCatKeyCacheTtlMs('not-a-number'), DEFAULT_CAT_KEY_CACHE_TTL_MS)
    // The configured value is what a longer window — the twelve hours the operator asked for — means.
    assert.equal(readCatKeyCacheTtlMs('900'), 900_000)
    assert.equal(readCatKeyCacheTtlMs('43200'), 43_200_000)
  })
}
