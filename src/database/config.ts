/**
 * Database - 配置
 * 从环境变量读取数据库开关和连接信息
 */

export interface DatabaseConfig {
  studioEnabled: boolean
  supabaseUrl: string
  supabaseKey: string
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    studioEnabled: process.env.ENABLE_STUDIO_DB === 'true',
    supabaseUrl: process.env.SUPABASE_URL?.trim() || '',
    supabaseKey: process.env.SUPABASE_KEY?.trim() || '',
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