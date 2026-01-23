/**
 * 任务状态路由
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
import { getJobResult, getBullJobStatus, getJobStage } from '../services/job-store'

const router = express.Router()
const logger = createLogger('JobStatusRoute')

/**
 * GET /api/jobs/:jobId
 * 检查动画生成任务状态
 * 响应格式与前端 api.ts JobResult 类型完全兼容
 * 注意：此路由不需要认证，因为查询任务状态是公开操作
 */
router.get(
  '/jobs/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params

    if (!jobId) {
      return res.status(400).json({
        error: '需要任务 ID',
        details: { jobId }
      })
    }

    logger.info('检查任务状态', { jobId })

    // 首先从 Bull 队列检查任务状态
    const bullJobStatus = await getBullJobStatus(jobId)

    if (bullJobStatus === 'active' || bullJobStatus === 'waiting' || bullJobStatus === 'delayed') {
      // 任务还在队列中或正在处理
      logger.info('任务在队列中或正在处理', { jobId, bullJobStatus })

      // 获取当前处理阶段
      const stage = await getJobStage(jobId)

      return res.status(200).json({
        jobId,
        status: bullJobStatus === 'waiting' || bullJobStatus === 'delayed' ? 'queued' : 'processing',
        stage: stage || 'analyzing',
        message: '正在生成动画...'
      })
    }

    // 从 Redis 读取最终结果
    const result = await getJobResult(jobId)

    if (!result) {
      // 任务不存在或已经清理
      if (bullJobStatus === null) {
        logger.info('未找到任务', { jobId })
        return res.status(404).json({
          error: '未找到任务',
          details: { jobId }
        })
      }
      // 任务还在处理中
      logger.info('任务仍在处理中', { jobId })
      return res.status(200).json({
        jobId,
        status: 'processing' as const,
        message: '正在生成动画...'
      })
    }

    if (result.status === 'completed') {
      logger.info('任务成功完成', { jobId })
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

    // 任务失败
    logger.info('任务失败', { jobId, error: result.data.error })
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
