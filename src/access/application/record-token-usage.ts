import { createLogger } from '../../shared/logging/logger'
import type { TokenUsageTotals, UsageSourceKind } from '../domain/usage-record'
import type { CatKeyRepository } from './ports/cat-key-repository'
import type { UsageRepository } from './ports/usage-repository'

const logger = createLogger('TokenUsageRecorder')

export interface TokenUsageRecorderDeps {
  usageRepository: UsageRepository
  catKeyRepository: CatKeyRepository
}

export interface RecordTokenUsageInput {
  /**
   * The CatKey that pays for this work. Absent means BYOK, which is never metered.
   *
   * Deliberately not a whole `AccessContext`: the Workflow queue and the Studio tool loop are
   * long-lived and only the id survives into them, while the context also carries the upstream
   * secret. Threading the context down would either fabricate one or copy the secret further.
   */
  catKeyId?: string
  /** The CatKey upstream model. Fixed by the server in CatKey mode, so no caller derives it. */
  model: string
  sourceKind: UsageSourceKind
  /** Workflow Job id or Studio Run id. The checkpoint key. */
  sourceId: string
  /** The totals the pipeline already computed; no re-derivation happens here. */
  totals: TokenUsageTotals
}

/**
 * Writes one Job's or Run's current cumulative usage.
 *
 * Dependencies arrive through a provider rather than as values because Supabase is optional at
 * boot: a BYOK-only deployment never configures it, and a BYOK call must not reach for it.
 */
export function createTokenUsageRecorder(provideDeps: () => TokenUsageRecorderDeps) {
  return async function recordTokenUsage(input: RecordTokenUsageInput): Promise<void> {
    // No CatKey means BYOK, which is billed by the user's own provider. This early return is the
    // only place that decides it, and it runs before any Supabase client is touched.
    if (!input.catKeyId) {
      return
    }

    const catKeyId = input.catKeyId
    const recordedAt = new Date()

    try {
      const deps = provideDeps()

      await deps.usageRepository.upsert(
        {
          catKeyId,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          model: input.model,
          ...input.totals
        },
        recordedAt
      )

      await deps.catKeyRepository.touchLastUsedAt(catKeyId, recordedAt)
    } catch (error) {
      // Metering is bookkeeping. A failed write is logged and dropped: it must never fail the
      // user's generation, which has already completed or is still running.
      logger.warn('Token 用量落库失败', {
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        error: String(error)
      })
    }
  }
}
