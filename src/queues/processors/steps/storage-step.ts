/**
 * 结果存储步骤
 * 存储任务结果到 Redis 和缓存
 */

import { storeJobResult } from '../../../services/job-store'
import { cacheResult } from './cache-step'
import type { RenderResult } from './render-step'
import { createLogger } from '../../../utils/logger'

const logger = createLogger('StorageStep')

/**
 * 存储结果
 */
export async function storeResult(
  renderResult: RenderResult,
  _timings: Record<string, number>
): Promise<void> {
  const { jobId, concept, manimCode, usedAI, generationType, quality, videoUrl } = renderResult

  // 存储到 Redis（用于 API 查询）
  await storeJobResult(jobId, {
    status: 'completed',
    data: {
      videoUrl,
      manimCode,
      usedAI,
      quality: quality as any,
      generationType: generationType as any
    }
  })
  logger.info('Result stored', { jobId, videoUrl })

  // 缓存结果（如果启用）
  await cacheResult(jobId, concept, quality, {
    manimCode,
    usedAI,
    generationType,
    videoUrl
  })
}
