/**
 * Routes Index
 * 路由总入口
 * - 统一挂载所有路由
 * - API 版本控制
 */

import express from 'express'
import generateRouter from './generate.route'
import jobStatusRouter from './job-status.route'
import healthRouter from './health.route'

const router = express.Router()

// 挂载健康检查路由（不使用 /api 前缀）
router.use(healthRouter)

// 挂载 API 路由（使用 /api 前缀）
router.use('/api', generateRouter)
router.use('/api', jobStatusRouter)

export default router
