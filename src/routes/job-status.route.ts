/**
 * Job Status Route
 * 迁移自 src/api/job-status.step.ts
 *
 * 主要改动：
 * - 移除 Motia 的 handler 包装
 * - 使用 Express Router
 * - 从 Redis 读取状态（使用改造后的 job-store）
 * - API 响应与前端 api.ts 类型完全兼容
 */

import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../middlewares/error-handler'
import { createLogger } from '../utils/logger'
import { getJobResult, getBullJobStatus } from '../services/job-store'

const router = express.Router()
const logger = createLogger('JobStatusRoute')

/**
 * GET /api/jobs/:jobId
 * Check animation generation job status
 * 响应格式与前端 api.ts JobResult 类型完全兼容
 */
router.get(
  '/jobs/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params

    if (!jobId) {
      return res.status(400).json({
        error: 'Job ID required',
        details: { jobId }
      })
    }

    logger.info('Checking status for job', { jobId })

    // 首先从 Bull 队列检查任务状态
    const bullJobStatus = await getBullJobStatus(jobId)

    if (bullJobStatus === 'active' || bullJobStatus === 'waiting' || bullJobStatus === 'delayed') {
      // 任务还在队列中或正在处理
      logger.info('Job is in queue or processing', { jobId, bullJobStatus })
      return res.status(200).json({
        jobId,
        status: bullJobStatus === 'waiting' || bullJobStatus === 'delayed' ? 'queued' : 'processing',
        message: 'Animation is being generated...'
      })
    }

    // 从 Redis 读取最终结果
    const result = await getJobResult(jobId)

    if (!result) {
      // 任务不存在或已经清理
      if (bullJobStatus === null) {
        logger.info('Job not found', { jobId })
        return res.status(404).json({
          error: 'Job not found',
          details: { jobId }
        })
      }
      // 任务还在处理中
      logger.info('Job still processing', { jobId })
      return res.status(200).json({
        jobId,
        status: 'processing' as const,
        message: 'Animation is being generated...'
      })
    }

    if (result.status === 'completed') {
      logger.info('Job completed successfully', { jobId })
      return res.status(200).json({
        jobId,
        status: 'completed' as const,
        success: true as const,
        video_url: result.data.videoUrl,
        code: result.data.manimCode,
        used_ai: result.data.usedAI,
        render_quality: result.data.quality,
        generation_type: result.data.generationType
      })
    }

    // Job failed
    logger.info('Job failed', { jobId, error: result.data.error })
    return res.status(200).json({
      jobId,
      status: 'failed' as const,
      success: false as const,
      error: result.data.error,
      details: result.data.details
    })
  })
)

export default router