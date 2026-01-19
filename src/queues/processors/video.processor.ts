/**
 * Video Processor
 * 任务处理器 - 整合所有 Motia Event Steps
 *
 * 整合内容：
 * 1. check-cache.step.ts       → checkCacheStep()
 * 2. analyze-concept.step.ts   → analyzeConceptStep()
 * 3. generate-code.step.ts     → generateCodeStep()
 * 4. render-video.step.ts      → renderVideoStep()
 * 5. store-result.step.ts      → storeResultStep()
 * 6. handle-cache-hit.step.ts  → handleCacheHitStep()
 *
 * 改动点：
 * - 移除 emit() 调用，改为函数调用
 * - 移除 InternalStateManager，改为 Redis
 * - 保持业务逻辑 100% 不变
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import crypto from 'crypto'
import { videoQueue } from '../../config/bull'
import { redisClient, REDIS_KEYS, generateRedisKey } from '../../config/redis'
import { storeJobResult } from '../../services/job-store'
import {
  isLikelyLatex,
  selectTemplate,
  generateLatexSceneCode,
  templateMappings,
  calculateMatchScore,
  TEMPLATE_MATCH_THRESHOLD
} from '../../services/manim-templates'
import { generateAIManimCode } from '../../services/openai-client'
import { isCachingEnabled, normalizeConcept, generateConceptHash } from '../../services/concept-cache'
import { createLogger } from '../../utils/logger'
import type { VideoJobData, JobResult, VideoQuality, GenerationType } from '../../types'

const logger = createLogger('VideoProcessor')

// 缓存键配置
const CONCEPT_CACHE_GROUP = 'concept-cache'
const CONCEPT_CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || '3600000', 10)  // 1 小时

// 质量标志
const QUALITY_FLAGS: Record<string, string> = {
  low: '-ql',
  medium: '-qm',
  high: '-qh'
}

/**
 * 任务处理器主函数
 */
videoQueue.process(async (job) => {
  const data = job.data as VideoJobData
  const { jobId, concept, quality, forceRefresh = false, timestamp } = data

  logger.info('Processing video job', { jobId, concept, quality })

  try {
    // Step 1: 检查缓存
    const cacheResult = await checkCacheStep(jobId, concept, quality, forceRefresh)

    if (cacheResult.hit) {
      // 缓存命中 - 直接处理缓存结果
      await handleCacheHitStep(jobId, concept, quality, cacheResult.data!)
      return { success: true, source: 'cache' }
    }

    // Step 2: 分析概念
    const analyzeResult = await analyzeConceptStep(jobId, concept, quality)

    // Step 3: 生成代码
    const codeResult = await generateCodeStep(jobId, concept, quality, analyzeResult)

    // Step 4: 渲染视频
    const renderResult = await renderVideoStep(jobId, concept, quality, codeResult)

    // Step 5: 存储结果
    await storeResultStep(renderResult)

    return { success: true, source: 'generation' }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Job failed', { jobId, error: errorMessage })

    // 存储失败结果
    await storeJobResult(jobId, {
      status: 'failed',
      data: { error: errorMessage }
    })

    throw error
  }
})

/**
 * Step 1: 检查缓存
 */
async function checkCacheStep(
  jobId: string,
  concept: string,
  quality: string,
  forceRefresh: boolean
): Promise<{ hit: boolean; data?: any }> {
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

    const cachedData = JSON.parse(cached) as any

    // 检查是否过期
    if (Date.now() > cachedData.expiresAt) {
      await redisClient.del(cacheKey)
      logger.info('Cache expired', { jobId, hash })
      return { hit: false }
    }

    logger.info('Cache hit', { jobId, originalJobId: cachedData.jobId })
    return {
      hit: true,
      data: {
        videoUrl: cachedData.videoUrl,
        manimCode: cachedData.manimCode,
        generationType: cachedData.generationType,
        usedAI: cachedData.usedAI,
        originalJobId: cachedData.jobId
      }
    }
  } catch (error) {
    logger.warn('Cache lookup failed', { jobId, error })
    return { hit: false }
  }
}

/**
 * Step 2: 分析概念
 */
async function analyzeConceptStep(
  jobId: string,
  concept: string,
  quality: string
): Promise<{
  analysisType: 'latex' | 'template' | 'ai' | 'fallback'
  manimCode: string | null
  needsAI: boolean
}> {
  logger.info('Analyzing concept', { jobId, concept })

  // 检查是否为 LaTeX
  if (isLikelyLatex(concept)) {
    logger.info('Detected LaTeX', { jobId })
    return {
      analysisType: 'latex',
      manimCode: generateLatexSceneCode(concept),
      needsAI: false
    }
  }

  // 尝试匹配模板
  const templateResult = selectTemplate(concept)
  if (templateResult) {
    logger.info('Matched template', { jobId, template: templateResult.templateName })
    return {
      analysisType: 'template',
      manimCode: templateResult.code,
      needsAI: false
    }
  }

  // 需要 AI 生成
  logger.info('Using AI for unique output', { jobId })
  return {
    analysisType: 'ai',
    manimCode: null,
    needsAI: true
  }
}

/**
 * Step 3: 生成代码
 */
async function generateCodeStep(
  jobId: string,
  concept: string,
  quality: string,
  analyzeResult: { analysisType: string; manimCode: string | null; needsAI: boolean }
): Promise<{
  manimCode: string
  usedAI: boolean
  generationType: string
}> {
  const { analysisType, manimCode, needsAI } = analyzeResult
  logger.info('Generating code', { jobId, needsAI, analysisType })

  // 基本可视化代码（fallback）
  const basicVisualizationCode = `from manim import *

class MainScene(Scene):
    def construct(self):
        text = Text("Animation for: ${concept}")
        self.play(Write(text))
        self.wait(1)
`.replace('${concept}', concept)

  if (needsAI) {
    // 使用 AI 生成
    try {
      const aiCode = await generateAIManimCode(concept)
      if (aiCode && aiCode.length > 0) {
        logger.info('AI code generated', { jobId, length: aiCode.length })
        return { manimCode: aiCode, usedAI: true, generationType: 'ai' }
      }
    } catch (error) {
      logger.warn('AI generation failed, using fallback', { jobId })
    }
    return { manimCode: basicVisualizationCode, usedAI: false, generationType: 'fallback' }
  }

  if (manimCode) {
    logger.info('Using pre-generated code', { jobId, length: manimCode.length })
    return { manimCode, usedAI: false, generationType: analysisType }
  }

  return { manimCode: basicVisualizationCode, usedAI: false, generationType: 'fallback' }
}

/**
 * Step 4: 渲染视频
 */
async function renderVideoStep(
  jobId: string,
  concept: string,
  quality: string,
  codeResult: { manimCode: string; usedAI: boolean; generationType: string }
): Promise<{
  jobId: string
  concept: string
  manimCode: string
  usedAI: boolean
  generationType: string
  quality: string
  videoUrl: string
}> {
  const { manimCode, usedAI, generationType } = codeResult
  logger.info('Rendering video', { jobId, quality })

  // 创建临时目录
  const tempDir = path.join(os.tmpdir(), `manim-${jobId}`)
  const mediaDir = path.join(tempDir, 'media')
  const codeFile = path.join(tempDir, 'scene.py')
  const outputDir = path.join(process.cwd(), 'public', 'videos')

  try {
    fs.mkdirSync(tempDir, { recursive: true })
    fs.mkdirSync(mediaDir, { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })

    // 写入代码文件
    fs.writeFileSync(codeFile, manimCode, 'utf-8')

    // 构建命令
    const qualityFlag = QUALITY_FLAGS[quality] || '-ql'
    const args = [
      'render',
      qualityFlag,
      '--format', 'mp4',
      '--media_dir', mediaDir,
      codeFile,
      'MainScene'
    ]

    logger.info('Running manim', { jobId, command: `manim ${args.join(' ')}` })

    // 执行 manim
    const result = await runManimCommand(args, tempDir, jobId)

    if (!result.success) {
      logger.error('Manim render failed', { jobId, stderr: result.stderr, stdout: result.stdout })
      throw new Error(result.stderr || 'Manim render failed')
    }

    // 查找生成的视频文件
    const videoPath = findVideoFile(mediaDir, quality)
    if (!videoPath) {
      throw new Error('Video file not found after render')
    }

    // 复制到输出目录
    const outputFilename = `${jobId}.mp4`
    const outputPath = path.join(outputDir, outputFilename)
    fs.copyFileSync(videoPath, outputPath)

    logger.info('Video saved', { jobId, outputPath })

    return {
      jobId,
      concept,
      manimCode,
      usedAI,
      generationType,
      quality,
      videoUrl: `/videos/${outputFilename}`
    }
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
      logger.info('Cleaned up temp dir', { jobId })
    } catch (error) {
      logger.warn('Cleanup failed', { jobId, error })
    }
  }
}

/**
 * Step 5: 存储结果（包含缓存）
 */
async function storeResultStep(data: {
  jobId: string
  concept: string
  manimCode: string
  usedAI: boolean
  generationType: string
  quality: string
  videoUrl: string
}): Promise<void> {
  const { jobId, concept, manimCode, usedAI, generationType, quality, videoUrl } = data

  // 存储到 Redis（用于 API 查询）
  await storeJobResult(jobId, {
    status: 'completed',
    data: { 
      videoUrl, 
      manimCode, 
      usedAI, 
      quality: quality as VideoQuality, 
      generationType: generationType as GenerationType 
    }
  })
  logger.info('Result stored', { jobId, videoUrl })

  // 缓存结果（如果启用）
  if (isCachingEnabled()) {
    try {
      const hash = generateConceptHash(concept, quality)
      const cacheKey = generateRedisKey(REDIS_KEYS.CONCEPT_CACHE, hash)
      const cacheEntry = {
        jobId,
        concept,
        normalizedConcept: normalizeConcept(concept),
        conceptHash: hash,
        quality,
        videoUrl,
        manimCode,
        generationType,
        usedAI,
        createdAt: Date.now(),
        expiresAt: Date.now() + CONCEPT_CACHE_TTL_MS
      }
      await redisClient.set(cacheKey, JSON.stringify(cacheEntry))
      logger.info('Result cached', { jobId, hash })
    } catch (error) {
      logger.warn('Cache store failed', { jobId, error })
    }
  }
}

/**
 * Step 6: 处理缓存命中
 */
async function handleCacheHitStep(
  jobId: string,
  concept: string,
  quality: string,
  cachedResult: {
    videoUrl: string
    manimCode: string
    generationType: string
    usedAI: boolean
    originalJobId: string
  }
): Promise<void> {
  logger.info('Processing cache hit', { jobId, originalJobId: cachedResult.originalJobId })

  // 直接存储缓存结果
  await storeJobResult(jobId, {
    status: 'completed',
    data: {
      videoUrl: cachedResult.videoUrl,
      manimCode: cachedResult.manimCode,
      usedAI: cachedResult.usedAI,
      quality: quality as VideoQuality,
      generationType: `cached:${cachedResult.generationType}` as GenerationType
    }
  })

  logger.info('Cache hit processed', { jobId, source: 'cache' })
}

/**
 * 执行 manim 命令
 */
function runManimCommand(
  args: string[],
  cwd: string,
  jobId: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('manim', args, { cwd })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        logger.info(`Job ${jobId}: Manim completed`)
        resolve({ success: true, stdout, stderr })
      } else {
        logger.error(`Job ${jobId}: Manim exited with code ${code}`, { stderr })
        resolve({ success: false, stdout, stderr })
      }
    })

    proc.on('error', (error) => {
      logger.error(`Job ${jobId}: Manim spawn failed`, { error: error.message })
      resolve({ success: false, stdout, stderr: error.message })
    })
  })
}

/**
 * 查找视频文件
 */
function findVideoFile(mediaDir: string, quality: string): string | null {
  const qualityFolders: Record<string, string[]> = {
    low: ['480p15'],
    medium: ['720p30'],
    high: ['1080p60']
  }

  const folders = qualityFolders[quality] || ['480p15']

  // 检查预期路径
  for (const folder of folders) {
    const expectedPath = path.join(mediaDir, 'videos', 'scene', folder, 'MainScene.mp4')
    if (fs.existsSync(expectedPath)) {
      return expectedPath
    }
  }

  // 递归搜索
  return findFileRecursive(mediaDir, 'MainScene.mp4')
}

/**
 * 递归查找文件
 */
function findFileRecursive(dir: string, filename: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, filename)
        if (found) return found
      } else if (entry.name === filename) {
        return fullPath
      }
    }
  } catch {
    // 忽略错误
  }

  return null
}
