import type { UsageRecordInput } from '../../domain/usage-record'

/**
 * Write side of the usage ledger.
 *
 * `upsert` overwrites the current cumulative value of one Job or Run. It is deliberately not an
 * append: a Studio Run reports usage more than once while it runs, and the row count is what the
 * maintainer reads as "request count".
 */
export interface UsageRepository {
  upsert(record: UsageRecordInput, recordedAt: Date): Promise<void>
}
