import type { CompletedJobResult, FailedJobResult } from '../../types'
import { getBullJobStatus, getJobResult } from '../../services/job-store'
import { readStudioPublicMediaLocator } from '../render/studio-public-media-locator'
import type { StudioRenderResultPort } from '../render/render-result-port'
import {
  STUDIO_RENDER_RESULT_ERROR_MAX_LENGTH,
  type StudioRenderResult,
  type StudioRenderResultMedia,
  type StudioRenderResultStatus
} from '../render/render-result-types'

/**
 * Job store backed render result port (task 11C1M).
 *
 * The only place that knows the existing queue. It reads — never writes — the job result and, when
 * no result is stored yet, the Bull state, and it maps them onto the domain result. The Worker stays
 * untouched: it keeps storing `JobResult`s exactly as it does today, and this adapter is how the
 * Studio runtime learns about them.
 *
 * Two honesty rules live here:
 *
 * 1. `getJobResult`/`getBullJobStatus` swallow every Redis error into `null`, so a read failure and
 *    an absent result are indistinguishable. Both answer `unknown`: a render is never marked failed
 *    because the store could not answer.
 * 2. A terminal Bull state without a stored `JobResult` (the 24 hour retention expired, the instance
 *    was rebuilt, the key was pruned) is also `unknown`, never a fabricated `completed`/`failed`.
 *
 * `code`, `provider`, `tokenUsage` and the whole result payload stay inside: only the public media
 * locators of a completed result cross this boundary.
 */
export function createJobStoreStudioRenderResultPort(): StudioRenderResultPort {
  return {
    async getRenderResult(jobId: string): Promise<StudioRenderResult> {
      const jobResult = await getJobResult(jobId)

      if (jobResult?.status === 'completed') {
        return { status: 'completed', media: readCompletedResultMedia(jobResult) }
      }
      if (jobResult?.status === 'failed') {
        return readFailedResult(jobResult)
      }

      const queueState = await getBullJobStatus(jobId)
      return { status: readStudioRenderResultStatusFromQueueState(queueState) }
    }
  }
}

/**
 * Bull state to domain status. `active` means the job is being rendered, `waiting`/`delayed` means
 * it is still queued, and anything else (absent job, connection failure, an unrecognised state)
 * answers `unknown` instead of inventing a terminal status.
 */
export function readStudioRenderResultStatusFromQueueState(
  queueState: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | null
): StudioRenderResultStatus {
  switch (queueState) {
    case 'active':
      return 'running'
    case 'waiting':
    case 'delayed':
      return 'queued'
    default:
      return 'unknown'
  }
}

/**
 * Public media of a completed result, in the order the current output mode produces them. Every
 * candidate must pass the shared public media policy, so a job that stored a workspace path or a
 * private absolute path simply has no public media (the render is still completed).
 */
export function readCompletedResultMedia(result: CompletedJobResult): StudioRenderResultMedia[] {
  const { outputMode, videoUrl, imageUrls } = result.data
  const ordered =
    outputMode === 'image'
      ? [...(imageUrls ?? []), videoUrl]
      : [videoUrl, ...(imageUrls ?? [])]

  const media: StudioRenderResultMedia[] = []
  for (const candidate of ordered) {
    const locator = readStudioPublicMediaLocator(candidate)
    if (!locator) {
      continue
    }
    media.push({ locator: locator.locator, ...(locator.mimeType ? { mimeType: locator.mimeType } : {}) })
  }
  return media
}

/**
 * A cancelled job is stored as a failed result carrying `cancelReason` (the cancel service writes
 * exactly that row), so the domain status can be distinguished without guessing. Failure text is
 * truncated and stays internal.
 */
function readFailedResult(result: FailedJobResult): StudioRenderResult {
  const error = typeof result.data.error === 'string' ? result.data.error : ''
  const internalError = error.slice(0, STUDIO_RENDER_RESULT_ERROR_MAX_LENGTH)

  if (result.data.cancelReason) {
    return { status: 'cancelled', ...(internalError ? { error: internalError } : {}) }
  }
  return { status: 'failed', ...(internalError ? { error: internalError } : {}) }
}
