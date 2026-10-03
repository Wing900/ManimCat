import type { StudioRenderStatus } from '../domain/core-types'

/**
 * Domain result of one render job, as the Studio runtime understands it (task 11C1M).
 *
 * `unknown` is a first-class answer: the job store cannot distinguish "no result yet" from
 * "the store is unavailable", because every read error is swallowed into `null`. A reconciler must
 * therefore never translate `unknown` into `failed` — it leaves the render where it is and reports
 * the uncertainty instead.
 */
export type StudioRenderResultStatus = StudioRenderStatus | 'unknown'

/** One public media candidate of a completed result, already validated by the locator policy. */
export interface StudioRenderResultMedia {
  locator: string
  mimeType?: string
}

export interface StudioRenderResult {
  status: StudioRenderResultStatus
  /**
   * Public media of a completed result, in the order the render produced them. Empty means the job
   * completed without a usable public resource: the render is still `completed`, and the missing
   * media is a capability gap rather than a failure.
   */
  media?: readonly StudioRenderResultMedia[]
  /**
   * Internal failure text. Stored on the render record for operators; never projected onto a public
   * DTO and never handed to the browser.
   */
  error?: string
}

/** Bound on the internal failure text kept on a render, so one provider dump cannot bloat a row. */
export const STUDIO_RENDER_RESULT_ERROR_MAX_LENGTH = 500
