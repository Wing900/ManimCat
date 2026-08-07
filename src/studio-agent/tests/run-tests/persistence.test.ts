import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStudioSession, createSupabaseStudioPersistence } from '../../index'
import { run } from './factories'

type Insertable = Record<string, unknown>

/**
 * Minimal supabase client spy that captures the row passed to `.insert()`
 * and echoes it back as the inserted row on `.single()`.
 */
function createSessionInsertSpy(): {
  client: SupabaseClient
  getInsertedRow: () => Insertable | null
} {
  let insertedRow: Insertable | null = null
  const builder = {
    insert(row: Insertable) {
      insertedRow = row
      return builder
    },
    select() {
      return builder
    },
    single() {
      return { data: insertedRow, error: null }
    },
  }
  const client = {
    from() {
      return builder
    },
  } as unknown as SupabaseClient
  return { client, getInsertedRow: () => insertedRow }
}

export async function runPersistenceTests(): Promise<void> {
  await run('session insert preserves legacy migration columns', async () => {
    const { client, getInsertedRow } = createSessionInsertSpy()
    const persistence = createSupabaseStudioPersistence(client)

    const session = createStudioSession({
      ownerId: 'owner-1',
      projectId: 'project-1',
      agentType: 'builder',
      title: 'Regression: legacy session insert',
      directory: 'plots',
    })

    const created = await persistence.sessionStore.create(session)

    assert.ok(created.id, 'create returns the persisted session')
    const row = getInsertedRow()
    assert.ok(row, 'insert was called with a session row')
    // The original migration keeps permission_level / permission_rules required.
    // Removing them from the insert payload breaks session creation on the legacy schema.
    assert.equal(row['permission_level'], 'L4')
    assert.deepEqual(row['permission_rules'], [])
  })
}
