/**
 * 结果存储步骤
 * 存储任务结果到 Redis
 */

import { storeJobResult } from '../../../../infrastructure/redis/job/redis-job-result-store'
import { ensureJobNotCancelled } from '../../../job/job-cancel'
import type { RenderResult } from './render-step-types'
import { createLogger } from '../../../../shared/logging/logger'
import { normalizeTimings } from '../../../../shared/time/timings'
import { getCurrentJobTokenUsage } from '../../../job/job-log-context'
import type { StoreJobResultOutcome } from '../../../job/job-types'

const logger = createLogger('StorageStep')

/**
 * 存储结果
 */
export async function storeResult(
  renderResult: RenderResult,
  timings: Record<string, number>,
  _clientId?: string
): Promise<StoreJobResultOutcome> {
  const {
    jobId,
    outputMode,
    code,
    codeLanguage,
    usedAI,
    generationType,
    quality,
    videoUrl,
    imageUrls,
    imageCount,
    workspaceVideoPath,
    workspaceImagePaths,
    renderPeakMemoryMB
  } = renderResult

  const normalizedTimings = normalizeTimings(timings)
  const tokenUsage = getCurrentJobTokenUsage()
  await ensureJobNotCancelled(jobId)

  const storeOutcome = await storeJobResult(jobId, {
    status: 'completed',
    data: {
      outputMode,
      videoUrl,
      imageUrls,
      imageCount,
      workspaceVideoPath,
      workspaceImagePaths,
      code,
      codeLanguage,
      usedAI,
      quality: quality as any,
      generationType: generationType as any,
      renderPeakMemoryMB,
      timings: normalizedTimings,
      tokenUsage
    }
  })
  logger.info('Result storage resolved', { jobId, outputMode, videoUrl, imageCount, storeOutcome })
  return storeOutcome

}
