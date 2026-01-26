/**
 * Video Processor
 * 任务处理器 - 主编排器
 *
 * 职责：任务流程编排，异常处理，计时统计
 */

import { videoQueue } from '../../config/bull'
import { storeJobResult } from '../../services/job-store'
import { createLogger } from '../../utils/logger'
import type { VideoJobData } from '../../types'

// 导入步骤模块
import { checkCache, handleCacheHit } from './steps/cache-step'
import { analyzeAndGenerate } from './steps/analysis-step'
import { renderVideo, handlePreGeneratedCode } from './steps/render-step'
import { storeResult } from './steps/storage-step'

const logger = createLogger('VideoProcessor')

/**
 * 任务处理器主函数
 */
videoQueue.process(async (job) => {
  const data = job.data as VideoJobData
  const { jobId, concept, quality, forceRefresh = false, preGeneratedCode } = data

  logger.info('Processing video job', { jobId, concept, quality, hasPreGeneratedCode: !!preGeneratedCode })

  // 阶段时长追踪
  const timings: Record<string, number> = {}

  try {
    // 如果有预生成代码，跳过缓存和 AI 生成阶段，直接渲染
    if (preGeneratedCode) {
      return await handlePreGeneratedCode(jobId, concept, quality, preGeneratedCode, timings, data)
    }

    // Step 1: 检查缓存
    await storeJobStage(jobId, 'analyzing')
    const cacheStart = Date.now()
    const cacheResult = await checkCache(jobId, concept, quality, forceRefresh, timings)
    timings.cache = Date.now() - cacheStart

    if (cacheResult.hit) {
      // 缓存命中 - 直接处理缓存结果
      await handleCacheHit(jobId, concept, quality, cacheResult.data!, timings)
      logger.info('Job completed (cache hit)', { jobId, timings })
      return { success: true, source: 'cache', timings }
    }

    // Step 2 & 3: 分析概念并生成代码
    await storeJobStage(jobId, 'generating')
    const analyzeStart = Date.now()
    const codeResult = await analyzeAndGenerate(jobId, concept, quality, timings, data.customApiConfig)
    timings.analyze = Date.now() - analyzeStart

    // Step 4: 渲染视频
    const renderStart = Date.now()
    const renderResult = await renderVideo(
      jobId,
      concept,
      quality,
      codeResult,
      timings,
      data.customApiConfig,
      data.videoConfig,
      () => storeJobStage(jobId, 'rendering')
    )
    timings.render = Date.now() - renderStart

    // Step 5: 存储结果
    const storeStart = Date.now()
    await storeResult(renderResult, timings)
    timings.store = Date.now() - storeStart

    // 总时长
    timings.total = timings.cache + timings.analyze + timings.render + timings.store

    logger.info('Job completed', { jobId, source: 'generation', timings })

    return { success: true, source: 'generation', timings }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Job failed', { jobId, error: errorMessage, timings })

    // 存储失败结果
    await storeJobResult(jobId, {
      status: 'failed',
      data: { error: errorMessage }
    })

    throw error
  }
})

/**
 * 存储任务阶段（辅助函数）
 */
async function storeJobStage(jobId: string, stage: string): Promise<void> {
  const { storeJobStage: storeStage } = await import('../../services/job-store')
  await storeStage(jobId, stage as any)
}
