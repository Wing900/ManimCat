import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatKeyRepository } from '../../application/ports/cat-key-repository'
import type { CatKeyRecord, CatKeyStatus } from '../../domain/cat-key'
import { InternalError } from '../../../shared/errors/errors'

const TABLE = 'cat_keys'
const COLUMNS = 'id, key_hash, key_prefix, label, status, created_at, last_used_at'

interface CatKeyRow {
  id: string
  key_hash: string
  key_prefix: string
  label: string | null
  status: string
  created_at: string
  last_used_at: string | null
}

export function createSupabaseCatKeyRepository(client: SupabaseClient): CatKeyRepository {
  return {
    async findByHash(keyHash: string): Promise<CatKeyRecord | undefined> {
      const { data, error } = await client
        .from(TABLE)
        .select(COLUMNS)
        .eq('key_hash', keyHash)
        .maybeSingle()

      if (error) {
        throw new InternalError(`CatKey 查询失败：${error.message}`)
      }
      if (!data) {
        return undefined
      }

      return toRecord(data as CatKeyRow)
    },

    async touchLastUsedAt(catKeyId: string, usedAt: Date): Promise<void> {
      const { error } = await client
        .from(TABLE)
        .update({ last_used_at: usedAt.toISOString() })
        .eq('id', catKeyId)

      if (error) {
        throw new InternalError(`CatKey last_used_at 更新失败：${error.message}`)
      }
    }
  }
}

function toRecord(row: CatKeyRow): CatKeyRecord {
  return {
    id: row.id,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    label: row.label,
    status: readStatus(row.status),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }
}

/**
 * The table's check constraint admits only `active` and `revoked`. A value outside that set means
 * the row was written before the constraint (or by hand), and reading it as revoked is the only
 * safe interpretation: an unrecognised status must not grant access.
 */
function readStatus(value: string): CatKeyStatus {
  return value === 'active' ? 'active' : 'revoked'
}
