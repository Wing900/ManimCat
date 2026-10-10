import type { SupabaseClient } from '@supabase/supabase-js'
import type { UsageRepository } from '../../application/ports/usage-repository'
import type { UsageRecordInput } from '../../domain/usage-record'
import { InternalError } from '../../../shared/errors/errors'

const TABLE = 'cat_key_usage'

/**
 * The conflict target of the checkpoint upsert, and it must match migration 013 exactly.
 *
 * `cat_key_id` leads so that two different CatKeys can never collide on a shared `source_id`;
 * a Job id is server-generated, but a cross-tenant overwrite is not a failure worth leaving open.
 */
const CONFLICT_TARGET = 'cat_key_id,source_kind,source_id'

export function createSupabaseUsageRepository(client: SupabaseClient): UsageRepository {
  return {
    async upsert(record: UsageRecordInput, recordedAt: Date): Promise<void> {
      const { error } = await client
        .from(TABLE)
        .upsert(
          {
            cat_key_id: record.catKeyId,
            source_kind: record.sourceKind,
            source_id: record.sourceId,
            model: record.model,
            prompt_tokens: record.promptTokens,
            completion_tokens: record.completionTokens,
            total_tokens: record.totalTokens,
            measured_calls: record.measuredCalls,
            unmeasured_calls: record.unmeasuredCalls,
            updated_at: recordedAt.toISOString()
          },
          { onConflict: CONFLICT_TARGET }
        )

      if (error) {
        throw new InternalError(`用量落库失败：${error.message}`)
      }
    }
  }
}
