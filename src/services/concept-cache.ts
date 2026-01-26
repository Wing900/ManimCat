/**
 * 概念缓存服务
 * 概念缓存和哈希生成的工具函数
 */

import crypto from 'crypto'

/**
 * 标准化概念以实现一致性缓存
 * - 转换为小写
 * - 去除首尾空白
 * - 合并多个空格
 * - 移除标点符号变化
 */
export function normalizeConcept(concept: string): string {
  return concept
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:'"]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 为标准化概念生成哈希
 * 用作精确匹配的缓存键
 */
export function generateConceptHash(concept: string, quality: string): string {
  const normalized = normalizeConcept(concept)
  return crypto
    .createHash('sha256')
    .update(`${normalized}:${quality}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * 通过环境变量检查缓存是否启用
 */
export function isCachingEnabled(): boolean {
  return process.env.DISABLE_CONCEPT_CACHE !== 'true'
}