/**
 * Stable, path-free failures for browser render preparation.
 *
 * The worker stores error.message in the job result, so filesystem errors must never
 * carry absolute paths into that field. The original cause is logged here, on the
 * server, and retained only as a non-serialized Error cause.
 */

import { createLogger } from '../../shared/logging/logger'

const logger = createLogger('BrowserRenderPreparation')

export type BrowserRenderPreparationErrorCode =
  | 'asset-storage'
  | 'invalid-source'
  | 'narration-unavailable'

export class BrowserRenderPreparationError extends Error {
  readonly code: BrowserRenderPreparationErrorCode

  constructor(
    code: BrowserRenderPreparationErrorCode,
    message: string,
    options: { cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BrowserRenderPreparationError'
    this.code = code
  }
}

/**
 * Convert an internal failure into a stable product error while keeping the original
 * cause and its server path in the log only.
 */
export function browserPreparationFailure(
  code: BrowserRenderPreparationErrorCode,
  message: string,
  cause: unknown,
  context: Record<string, unknown> = {}
): BrowserRenderPreparationError {
  if (cause instanceof BrowserRenderPreparationError) {
    return cause
  }
  logger.warn('Browser render preparation failed', {
    ...context,
    code,
    cause: cause instanceof Error ? cause.message : String(cause),
  })
  return new BrowserRenderPreparationError(code, message, { cause })
}
