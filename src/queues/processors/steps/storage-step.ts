/**
 * 结果存储步骤
 * 存储任务结果到 Redis 和缓存
 */

import { storeJobResult } from '../../../services/job-store'
import { clearJobCancelled } from '../../../services/job-cancel-store'
import { cacheResult } from './cache-step'
import type { RenderResult } from './render-step'
import { createLogger } from '../../../utils/logger'
import { normalizeTimings } from '../../../utils/timings'

const logger = createLogger('StorageStep')

/**
 * 存储结果
 */
export async function storeResult(
  renderResult: RenderResult,
  timings: Record<string, number>,
  options: { skipCache?: boolean } = {}
): Promise<void> {
  const { jobId, concept, manimCode, usedAI, generationType, quality, videoUrl, renderPeakMemoryMB } = renderResult
  const { skipCache = false } = options

  // 存储到 Redis（用于 API 查询）
  const normalizedTimings = normalizeTimings(timings)

  await storeJobResult(jobId, {
    status: 'completed',
    data: {
      videoUrl,
      manimCode,
      usedAI,
      quality: quality as any,
      generationType: generationType as any,
      renderPeakMemoryMB,
      timings: normalizedTimings
    }
  })
  await clearJobCancelled(jobId)
  logger.info('Result stored', { jobId, videoUrl })

  // 缓存结果（如果启用）
  await cacheResult(jobId, concept, quality, {
    manimCode,
    usedAI,
    generationType,
    videoUrl
  })
}
