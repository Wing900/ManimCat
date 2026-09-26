/**
 * 结果存储步骤
 * 存储任务结果到 Redis，并写入持久化历史记录
 */

import { storeJobResult } from '../../../services/job-store'
import { ensureJobNotCancelled } from '../../../services/job-cancel'
import { createHistory } from '../../../database'
import type { RenderResult } from './render-step-types'
import { createLogger } from '../../../utils/logger'
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

  if (clientId && storeOutcome === 'stored') {
    try {
      await createHistory({
        client_id: clientId,
        prompt: concept,
        code: code || null,
        output_mode: outputMode as 'video' | 'image',
        quality: quality as 'low' | 'medium' | 'high',
        status: 'completed'
      })
    } catch (err) {
      logger.warn('Failed to write history record', { jobId, error: err })
    }
  }
}
