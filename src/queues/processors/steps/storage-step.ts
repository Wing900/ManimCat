/**
 * 结果存储步骤
 * 存储任务结果到 Redis
 */

import { storeJobResult } from '../../../services/job-store'
import { clearJobCancelled } from '../../../services/job-cancel-store'
import type { RenderResult } from './render-step'
import { createLogger } from '../../../utils/logger'
import { normalizeTimings } from '../../../utils/timings'

const logger = createLogger('StorageStep')

/**
 * 存储结果
 */
export async function storeResult(
  renderResult: RenderResult,
  timings: Record<string, number>
): Promise<void> {
  const {
    jobId,
    outputMode,
    manimCode,
    usedAI,
    generationType,
    quality,
    videoUrl,
    imageUrls,
    imageCount,
    renderPeakMemoryMB
  } = renderResult

  // 存储到 Redis（用于 API 查询）
  const normalizedTimings = normalizeTimings(timings)

  await storeJobResult(jobId, {
    status: 'completed',
    data: {
      outputMode,
      videoUrl,
      imageUrls,
      imageCount,
      manimCode,
      usedAI,
      quality: quality as any,
      generationType: generationType as any,
      renderPeakMemoryMB,
      timings: normalizedTimings
    }
  })
  await clearJobCancelled(jobId)
  logger.info('Result stored', { jobId, outputMode, videoUrl, imageCount })
}
