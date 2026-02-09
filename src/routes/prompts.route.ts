/**
 * 提示词管理 API 路由
 */

import express from 'express'
import { getAllDefaultTemplates, type RoleType, type SharedModuleType } from '../prompts'

const router = express.Router()

// ============================================================================
// 类型定义（前端使用）
// ============================================================================

interface PromptDefaults {
  roles: Record<RoleType, { system: string; user: string }>
  shared: Record<SharedModuleType, string>
}

// ============================================================================
// 路由
// ============================================================================

/**
 * GET /api/prompts/defaults
 * 获取所有默认提示词模板
 */
router.get('/prompts/defaults', (_req, res) => {
  const defaults: PromptDefaults = getAllDefaultTemplates()
  res.json(defaults)
})

export default router
