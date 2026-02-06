/**
 * 缓存管理步骤
 * 缓存检查、存储、命中处理
 */

import { redisClient, REDIS_KEYS, generateRedisKey } from '../../../config/redis'
import { isCachingEnabled, normalizeConcept, generateConceptHash } from '../../../services/concept-cache'
import { storeJobResult } from '../../../services/job-store'
import { createLogger } from '../../../utils/logger'
import { normalizeTimings } from '../../../utils/timings'
import type { VideoQuality, GenerationType, ConceptCacheData } from '../../../types'

const logger = createLogger('CacheStep')

// 缓存键配置
const CONCEPT_CACHE_GROUP = 'concept-cache'
const CONCEPT_CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || '3600000', 10) // 1 小时

/**
 * 缓存检查结果
 */
export interface CacheCheckResult {
  hit: boolean
  data?: CacheHitData
}

/**
 * 缓存命中数据（用于返回给调用方）
 */
export interface CacheHitData extends ConceptCacheData {
  originalJobId: string
}

/**
 * 缓存命中数据（扩展版本，包含内部字段）
 */
interface CachedData extends ConceptCacheData {
  expiresAt: number
  normalizedConcept: string
  originalJobId?: string
}

/**
 * 检查缓存
 */
export async function checkCache(
  jobId: string,
  concept: string,
  quality: string,
  forceRefresh: boolean,
  _timings: Record<string, number>
): Promise<CacheCheckResult> {
  logger.info('Checking cache', { jobId, forceRefresh })

  // 如果禁用缓存或强制刷新，跳过缓存
  if (!isCachingEnabled() || forceRefresh) {
    logger.info('Cache bypassed', { jobId, reason: forceRefresh ? 'force_refresh' : 'caching_disabled' })
    return { hit: false }
  }

  // 检查缓存
  const hash = generateConceptHash(concept, quality)
  const cacheKey = generateRedisKey(REDIS_KEYS.CONCEPT_CACHE, hash)

  try {
    const cached = await redisClient.get(cacheKey)
    if (!cached) {
      logger.info('Cache miss', { jobId, hash })
      return { hit: false }
    }

    const cachedData = JSON.parse(cached) as CachedData

    // 检查是否过期
    if (Date.now() > cachedData.expiresAt) {
      await redisClient.del(cacheKey)
      logger.info('Cache expired', { jobId, hash })
      return { hit: false }
    }

    logger.info('Cache hit', { jobId, originalJobId: cachedData.originalJobId })
    return {
      hit: true,
      data: {
        videoUrl: cachedData.videoUrl,
        manimCode: cachedData.manimCode,
        generationType: cachedData.generationType,
        usedAI: cachedData.usedAI,
        originalJobId: cachedData.originalJobId || cachedData.jobId,
        jobId: cachedData.jobId,
        conceptHash: cachedData.conceptHash,
        concept: cachedData.concept,
        quality: cachedData.quality,
        createdAt: cachedData.createdAt
      }
    }
  } catch (error) {
    logger.warn('Cache lookup failed', { jobId, error })
    return { hit: false }
  }
}

/**
 * 存储到缓存
 */
export async function cacheResult(
  jobId: string,
  concept: string,
  quality: string,
  result: {
    manimCode: string
    usedAI: boolean
    generationType: string
    videoUrl: string
  }
): Promise<void> {
  if (!isCachingEnabled()) {
    return
  }

  try {
    const hash = generateConceptHash(concept, quality)
    const cacheKey = generateRedisKey(REDIS_KEYS.CONCEPT_CACHE, hash)
    const cacheEntry = {
      jobId,
      concept,
      normalizedConcept: normalizeConcept(concept),
      conceptHash: hash,
      quality,
      videoUrl: result.videoUrl,
      manimCode: result.manimCode,
      generationType: result.generationType,
      usedAI: result.usedAI,
      createdAt: Date.now(),
      expiresAt: Date.now() + CONCEPT_CACHE_TTL_MS
    }
    await redisClient.set(cacheKey, JSON.stringify(cacheEntry))
    logger.info('Result cached', { jobId, hash })
  } catch (error) {
    logger.warn('Cache store failed', { jobId, error })
  }
}

/**
 * 处理缓存命中
 */
export async function handleCacheHit(
  jobId: string,
  _concept: string,
  quality: string,
  cachedData: CacheHitData,
  timings: Record<string, number>
): Promise<void> {
  logger.info('Processing cache hit', { jobId, originalJobId: cachedData.originalJobId })

  const normalizedTimings = normalizeTimings(timings)

  // 直接存储缓存结果
  await storeJobResult(jobId, {
    status: 'completed',
    data: {
      videoUrl: cachedData.videoUrl,
      manimCode: cachedData.manimCode,
      usedAI: cachedData.usedAI,
      quality: quality as VideoQuality,
      generationType: `cached:${cachedData.generationType}` as GenerationType,
      timings: normalizedTimings
    }
  })

  logger.info('Cache hit processed', { jobId, source: 'cache' })
}
