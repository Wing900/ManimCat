/**
 * Routes Index
 * 璺敱鎬诲叆鍙?
 * - 缁熶竴鎸傝浇鎵€鏈夎矾鐢?
 * - API 鐗堟湰鎺у埗
 */

import express from 'express'
import generateRouter from './generate.route'
import modifyRouter from './modify.route'
import jobStatusRouter from './job-status.route'
import jobCancelRouter from './job-cancel.route'
import promptsRouter from './prompts.route'
import healthRouter from './health.route'
import metricsRouter from './metrics.route'
import aiTestRouter from './ai-test.route'
import aiModelsRouter from './ai-models.route'
import referenceImageUploadRouter from './reference-image-upload.route'
import renderFailuresRouter from './render-failures.route'
import problemFrameRouter from './problem-frame.route'
import studioAgentRouter from './studio-agent.route'

const router = express.Router()

// 鎸傝浇鍋ュ悍妫€鏌ヨ矾鐢憋紙涓嶄娇鐢?/api 鍓嶇紑锛?
router.use(healthRouter)

// 鎸傝浇 API 璺敱锛堜娇鐢?/api 鍓嶇紑锛?
router.use('/api', generateRouter)
router.use('/api', modifyRouter)
router.use('/api', jobStatusRouter)
router.use('/api', jobCancelRouter)
router.use('/api', promptsRouter)
router.use('/api', aiTestRouter)
router.use('/api', aiModelsRouter)
router.use('/api', referenceImageUploadRouter)
router.use('/api', problemFrameRouter)
router.use('/api', studioAgentRouter)
router.use('/api/metrics', metricsRouter)
router.use('/api/admin', renderFailuresRouter)

export default router

