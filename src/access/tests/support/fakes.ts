import assert from 'node:assert/strict'
import type { CatKeyRecord } from '../../domain/cat-key'
import type { UsageRecordInput } from '../../domain/usage-record'
import type { CatKeyRepository } from '../../application/ports/cat-key-repository'
import type { UsageRepository } from '../../application/ports/usage-repository'

/** Mirrors the studio-agent suite's runner so the output format stays uniform. */
export async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

/** Asserts that `fn` rejects, and hands back the error so its message can be checked. */
export async function rejects(fn: () => Promise<unknown>, expectedName: string): Promise<Error> {
  try {
    await fn()
  } catch (error) {
    const typed = error as Error
    assert.equal(typed.name, expectedName, `expected ${expectedName}, got ${typed.name}: ${typed.message}`)
    assert.equal(typed.constructor.name, expectedName)
    return typed
  }

  throw new Error(`expected ${expectedName} to be thrown, but nothing was`)
}

export interface FakeCatKeyRepository {
  repository: CatKeyRepository
  /** Every hash handed to `findByHash`, in order. */
  readonly queriedHashes: string[]
  /** Every successful `touchLastUsedAt` call, in order. */
  readonly touches: Array<{ catKeyId: string; usedAt: Date }>
}

export function createFakeCatKeyRepository(records: readonly CatKeyRecord[] = []): FakeCatKeyRepository {
  const queriedHashes: string[] = []
  const touches: Array<{ catKeyId: string; usedAt: Date }> = []

  return {
    queriedHashes,
    touches,
    repository: {
      async findByHash(keyHash: string) {
        queriedHashes.push(keyHash)
        return records.find((record) => record.keyHash === keyHash)
      },
      async touchLastUsedAt(catKeyId: string, usedAt: Date) {
        touches.push({ catKeyId, usedAt })
      }
    }
  }
}

export interface FakeUsageRepository {
  repository: UsageRepository
  readonly upserts: Array<{ record: UsageRecordInput; recordedAt: Date }>
}

export function createFakeUsageRepository(options: { failWith?: Error } = {}): FakeUsageRepository {
  const upserts: Array<{ record: UsageRecordInput; recordedAt: Date }> = []

  return {
    upserts,
    repository: {
      async upsert(record: UsageRecordInput, recordedAt: Date) {
        if (options.failWith) {
          throw options.failWith
        }
        upserts.push({ record, recordedAt })
      }
    }
  }
}

export function createCatKeyRecord(overrides: Partial<CatKeyRecord> = {}): CatKeyRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    keyHash: 'unset',
    keyPrefix: 'mc_01234567',
    label: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides
  }
}
