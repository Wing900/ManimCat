import { createLogger } from '../../utils/logger'
import type { StudioTokenUsage } from '../domain/types'
import {
  accumulateStudioTokenUsage,
  createEmptyStudioTokenUsage,
  normalizeStudioModelUsage,
  readStudioTokenUsage,
  unmeasuredStudioCallTokenUsage
} from './token-usage'

const logger = createLogger('StudioTokenUsage')

/** Persists and publishes the cumulative value (wired to the run checkpoint transport). */
export type StudioTokenUsageCheckpoint = (usage: StudioTokenUsage) => Promise<void>

/**
 * Run-scoped tracker. It owns the cumulative value for one Tool Loop execution and is the
 * single accumulation point: exactly one increment happens per provider invocation, and
 * the arithmetic itself stays in token-usage.ts.
 *
 * The owned value never escapes by reference: readers and checkpoint callbacks receive a
 * fresh copy, so a mutating callback cannot corrupt the tracker's state.
 */
export class StudioTokenUsageTracker {
  private usage: StudioTokenUsage

  constructor(private readonly input: {
    initialUsage?: StudioTokenUsage
    checkpoint?: StudioTokenUsageCheckpoint
  } = {}) {
    // Resumed or continued execution keeps prior totals instead of restarting at zero.
    this.usage = readStudioTokenUsage(input.initialUsage) ?? createEmptyStudioTokenUsage()
  }

  get current(): StudioTokenUsage {
    return this.snapshot()
  }

  /** Fresh copy of the owned value; the tracker is a flat, five-number object. */
  private snapshot(): StudioTokenUsage {
    return { ...this.usage }
  }

  /**
   * Runs one provider invocation, counts it exactly once, and persists the cumulative
   * value before the caller continues with the response.
   *
   * On provider failure the call is counted as unmeasured, the checkpoint is attempted,
   * and the original error is rethrown unchanged. A checkpoint failure on that path is
   * logged and never replaces the provider error.
   */
  async trackProviderCall<T>(input: {
    invoke: () => Promise<T>
    readUsage?: (value: T) => unknown
  }): Promise<T> {
    let value: T
    try {
      value = await input.invoke()
    } catch (error) {
      this.usage = accumulateStudioTokenUsage(this.usage, unmeasuredStudioCallTokenUsage())
      await this.checkpointAfterFailure(error)
      throw error
    }

    const providerUsage = input.readUsage ? input.readUsage(value) : undefined
    this.usage = accumulateStudioTokenUsage(this.usage, normalizeStudioModelUsage(providerUsage))
    await this.input.checkpoint?.(this.snapshot())
    return value
  }

  private async checkpointAfterFailure(providerError: unknown): Promise<void> {
    if (!this.input.checkpoint) {
      return
    }

    try {
      await this.input.checkpoint(this.snapshot())
    } catch (checkpointError) {
      logger.warn('Studio token usage checkpoint failed after a provider error', {
        message: checkpointError instanceof Error ? checkpointError.message : String(checkpointError),
        providerMessage: providerError instanceof Error ? providerError.message : String(providerError)
      })
    }
  }
}
