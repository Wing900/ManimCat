/**
 * Database - Supabase 客户端
 * 懒初始化。只要 Supabase 连接信息完整即可创建，具体业务是否启用由上层开关决定。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getDatabaseConfig, isSupabaseConfigured } from './config'

let _client: SupabaseClient | null = null

/**
 * 获取 Supabase 客户端实例（单例）
 * 如果连接信息不完整，返回 null
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null
  }

  if (!_client) {
    const cfg = getDatabaseConfig()
    _client = createClient(cfg.supabaseUrl, cfg.supabaseKey)
    console.log('[Database] Supabase client initialized')
  }

  return _client
}
