/**
 * Database - 统一导出
 */

export { getDatabaseConfig, isDatabaseReady, isStudioDatabaseReady, isSupabaseConfigured } from './config'
export { getSupabaseClient } from './client'
export { createHistory, listHistory, getHistory, deleteHistory } from './history.service'
export type { HistoryRow, CreateHistoryInput, PaginatedResult } from './types'
