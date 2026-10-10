/**
 * Database - 配置
 * 从环境变量读取数据库开关和连接信息
 */

import { createLogger } from '../../shared/logging/logger'

const logger = createLogger('DatabaseConfig')

export interface DatabaseConfig {
  studioEnabled: boolean
  supabaseUrl: string
  supabaseKey: string
}

/**
 * 读取 Supabase 服务端 Key。
 * 首选 SUPABASE_SERVICE_ROLE_KEY；SUPABASE_KEY 为旧名，仅作一次性回退。
 */
function readSupabaseServiceRoleKey(): string {
  const current = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (current) {
    return current
  }

  const legacy = process.env.SUPABASE_KEY?.trim()
  if (legacy) {
    logger.warn('SUPABASE_KEY 已弃用，请改用 SUPABASE_SERVICE_ROLE_KEY')
    return legacy
  }

  return ''
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    studioEnabled: process.env.ENABLE_STUDIO_DB === 'true',
    supabaseUrl: process.env.SUPABASE_URL?.trim() || '',
    supabaseKey: readSupabaseServiceRoleKey(),
  }
}

export function isSupabaseConfigured(): boolean {
  const cfg = getDatabaseConfig()
  return Boolean(cfg.supabaseUrl) && Boolean(cfg.supabaseKey)
}

/**
 * 检查 Studio 持久化数据库配置是否就绪
 */
export function isStudioDatabaseReady(): boolean {
  const cfg = getDatabaseConfig()
  return cfg.studioEnabled && isSupabaseConfigured()
}