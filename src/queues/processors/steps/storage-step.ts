/**
 * 结果存储步骤
 * 存储任务结果到 Redis
 */

import { storeJobResult } from '../../../infrastructure/redis/job/redis-job-result-store'
import { ensureJobNotCancelled } from '../../../services/job-cancel'
import type { RenderResult } from './render-step-types'
import { createLogger } from '../../../shared/logging/logger'
import { normalizeTimings } from '../../../utils/timings'
import { getCurrentJobTokenUsage } from '../../../services/job-log-context'

const logger = createLogger('StorageStep')

/**
 * 存储结果
 */
export async function storeResult(
  renderResult: RenderResult,
  timings: Record<string, number>,
  clientId?: string
): Promise<void> {
  const {
    jobId,
    concept,
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

}
