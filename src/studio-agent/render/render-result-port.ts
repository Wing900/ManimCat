import type { StudioRenderResult } from './render-result-types'

/**
 * Read-only view of one render job (task 11C1M).
 *
 * The interface carries no queue, Redis or job-store type on purpose: the production adapter that
 * knows about the job store is injected at the composition root, and tests that import the pure
 * services never connect to Redis. The reconciler only ever asks about a `jobId` that came from a
 * persisted render record — a caller can never substitute one.
 */
export interface StudioRenderResultPort {
  getRenderResult: (jobId: string) => Promise<StudioRenderResult>
}

/**
 * Default port for runtimes without a job store (in-memory tests, single-process runs): every
 * question answers `unknown`, so a reconciliation never invents a status.
 */
export function createUnavailableStudioRenderResultPort(): StudioRenderResultPort {
  return {
    getRenderResult: async () => ({ status: 'unknown' })
  }
}
