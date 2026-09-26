/**
 * 任务状态路由
 * 迁移自 src/api/job-status.step.ts
 *
 * 主要改动：
 * - 使用 Express Router
 * - 使用 Express Router
 * - 从 Redis 读取状态（使用改造后的 job-store）
 * - API 响应与前端 api.ts 类型完全兼容
 */

import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import { assertJobAccess, getJobAccessCreatedAt } from '../services/job-access-store'
import { createLogger } from '../utils/logger'
import { getJobResult, getBullJobStatus, getJobStage, getJobTrackingState } from '../services/job-store'
import { getRequestClientId } from '../utils/request-client-id'

const router = express.Router()
const logger = createLogger('JobStatusRoute')
const configuredTrackingStaleMs = parseInt(process.env.JOB_TRACKING_STALE_MS || '60000', 10)
const JOB_TRACKING_STALE_MS = Number.isFinite(configuredTrackingStaleMs) && configuredTrackingStaleMs > 0
  ? configuredTrackingStaleMs
  : 60_000

/**
 * GET /api/jobs/:jobId
 * 检查动画生成任务状态
 * 响应格式与前端 api.ts JobResult 类型完全兼容
 * 注意：此路由不需要认证，因为查询任务状态是公开操作
 */
router.get(
  '/jobs/:jobId',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params

    if (!jobId) {
      return res.status(400).json({
        error: '需要任务 ID',
        details: { jobId }
      })
    }

    logger.debug('检查任务状态', { jobId })
    await assertJobAccess({
      jobId,
      apiKey: res.locals.manimcatApiKey as string,
      clientId: getRequestClientId(req),
    })
    const tracking = await getJobTrackingState(jobId)
    const accessCreatedAt = await getJobAccessCreatedAt(jobId)
    const submittedAt = tracking?.submittedAt
      ?? (typeof accessCreatedAt === 'number' ? new Date(accessCreatedAt).toISOString() : undefined)
    const revision = tracking?.revision ?? 0
    const attempt = tracking?.attempt ?? 1
    const updatedAt = tracking?.updatedAt

    // Terminal Result 是权威状态，Bull 中残留的 Active/Waiting 不得遮蔽终态。
    const result = await getJobResult(jobId)

    if (result?.status === 'completed') {
      logger.info('任务成功完成', { jobId })
      return res.status(200).json({
        jobId,
        status: 'completed' as const,
        success: true as const,
        submitted_at: submittedAt,
        finished_at: new Date(result.timestamp).toISOString(),
        updated_at: updatedAt,
        revision,
        attempt,
        output_mode: result.data.outputMode || 'video',
        video_url: result.data.videoUrl ?? null,
        image_urls: result.data.imageUrls,
        image_count: result.data.imageCount,
        code: result.data.code,
        used_ai: result.data.usedAI,
        render_quality: result.data.quality,
        generation_type: result.data.generationType,
        render_peak_memory_mb: result.data.renderPeakMemoryMB,
        timings: result.data.timings,
        token_usage: result.data.tokenUsage,
      })
    }

    if (result?.status === 'failed') {
      logger.info('任务失败', { jobId, error: result.data.error })
      return res.status(200).json({
        jobId,
        status: 'failed' as const,
        success: false as const,
        submitted_at: submittedAt,
        finished_at: new Date(result.timestamp).toISOString(),
        updated_at: updatedAt,
        revision,
        attempt,
        error: result.data.error,
        details: result.data.details,
        cancel_reason: result.data.cancelReason,
        token_usage: result.data.tokenUsage,
      })
    }

    const bullJobStatus = await getBullJobStatus(jobId)

    if (bullJobStatus === 'active' || bullJobStatus === 'waiting' || bullJobStatus === 'delayed') {
      // 任务还在队列中或正在处理
      logger.debug('任务在队列中或正在处理', { jobId, bullJobStatus })

      // 获取当前处理阶段
      const stage = await getJobStage(jobId)

      return res.status(200).json({
        jobId,
        status: bullJobStatus === 'waiting' || bullJobStatus === 'delayed' ? 'queued' : 'processing',
        stage: stage || 'analyzing',
        message: '正在生成内容...',
        submitted_at: submittedAt,
        updated_at: updatedAt,
        revision,
        attempt,
      })
    }

    const trackingAgeMs = updatedAt ? Date.now() - new Date(updatedAt).getTime() : Number.POSITIVE_INFINITY
    const trackingIsFresh = (
      tracking?.status === 'queued' || tracking?.status === 'processing'
    ) && Number.isFinite(trackingAgeMs) && trackingAgeMs <= JOB_TRACKING_STALE_MS

    if (trackingIsFresh) {
      logger.warn('Bull 任务记录暂时缺失，使用新鲜的 Worker 心跳维持处理中状态', {
        jobId,
        trackingAgeMs,
      })
      const stage = tracking?.stage || await getJobStage(jobId)
      return res.status(200).json({
        jobId,
        status: tracking?.status === 'queued' ? 'queued' as const : 'processing' as const,
        stage: stage || 'analyzing',
        message: '正在生成内容...',
        submitted_at: submittedAt,
        updated_at: updatedAt,
        revision,
        attempt,
      })
    }

    logger.warn('任务记录与 Worker 心跳均已失效', { jobId, bullJobStatus, trackingAgeMs })
    return res.status(200).json({
      jobId,
      status: 'failed' as const,
      success: false as const,
      error: '任务已失效或不存在',
      message: '任务执行记录与 Worker 心跳均已失效，请重新提交生成请求',
      submitted_at: submittedAt,
      finished_at: new Date().toISOString(),
      updated_at: updatedAt,
      revision,
      attempt,
    })
  })
)

export default router

