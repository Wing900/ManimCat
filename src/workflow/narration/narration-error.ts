/**
 * Narrow error surface for narration preparation.
 *
 * The TTS service is online: a failure is a failure. These errors never stand in
 * for missing audio, and cancellation stays distinguishable from a voice failure.
 */

export type NarrationErrorCode =
  | 'NARRATION_DISABLED'
  | 'INVALID_CONFIG'
  | 'INVALID_PLAN'
  | 'INVALID_MARKER'
  | 'DUPLICATE_CUE'
  | 'EMPTY_SEGMENT_TEXT'
  | 'CUE_UNMAPPED'
  | 'TTS_FAILED'
  | 'WORKER_FAILED'
  | 'WORKER_MISSING'
  | 'WAV_INVALID'
  | 'CACHE_INVALID'
  | 'CANCELLED'

export class NarrationError extends Error {
  readonly code: NarrationErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: NarrationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = code === 'CANCELLED' ? 'AbortError' : 'NarrationError'
    this.code = code
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function createCancellationError(signal?: AbortSignal): NarrationError {
  const reason = signal?.reason
  const message =
    reason instanceof Error && reason.message
      ? `Narration preparation was cancelled: ${reason.message}`
      : 'Narration preparation was cancelled'
  return new NarrationError('CANCELLED', message, { reason: String(reason ?? 'aborted') })
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createCancellationError(signal)
  }
}
