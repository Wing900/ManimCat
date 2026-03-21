/**
 * Application Configuration
 * 应用全局配置
 */

import * as dotenv from 'dotenv'

// 加载环境变量
dotenv.config()

/**
 * 应用配置
 */
export const appConfig = {
  // 服务器配置
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // CORS 配置
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  },

  // 超时配置
  timeout: {
    request: parseInt(process.env.REQUEST_TIMEOUT || '600000', 10),
    job: parseInt(process.env.JOB_TIMEOUT || '600000', 10)
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    pretty: process.env.NODE_ENV === 'development'
  },

  // AI 配置（上游地址/密钥/模型由 MANIMCAT_ROUTE_* 或请求 customApiConfig 提供）
  ai: {
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '12000', 10),
    thinkingTokens: parseInt(process.env.AI_THINKING_TOKENS || '20000', 10)
  },

  // Manim 配置
  manim: {
    quality: {
      low: '-ql',
      medium: '-qm',
      high: '-qh'
    },
    timeout: parseInt(process.env.MANIM_TIMEOUT || '600000', 10)
  },

  // 文件系统配置
  paths: {
    videos: process.env.VIDEO_OUTPUT_DIR || 'public/videos',
    temp: process.env.TEMP_DIR || 'temp'
  }
} as const

export function validateConfig(): void {
  const routeKeys = process.env.MANIMCAT_ROUTE_KEYS?.trim()
  const routeApiUrls = process.env.MANIMCAT_ROUTE_API_URLS?.trim()
  const routeApiKeys = process.env.MANIMCAT_ROUTE_API_KEYS?.trim()
  const routeModels = process.env.MANIMCAT_ROUTE_MODELS?.trim()
  const hasRouteBasedUpstream = Boolean(routeKeys && routeApiUrls && routeApiKeys && routeModels)

  if (!hasRouteBasedUpstream) {
    console.warn(
      '[Config] No MANIMCAT_ROUTE_* upstream mapping found. AI requests need customApiConfig per request.'
    )
  }
}

export function isDevelopment(): boolean {
  return appConfig.nodeEnv === 'development'
}

export function isProduction(): boolean {
  return appConfig.nodeEnv === 'production'
}

export function printConfig(): void {
  console.log('📋 Application Configuration:')
  console.log(`  - Environment: ${appConfig.nodeEnv}`)
  console.log(`  - Port: ${appConfig.port}`)
  console.log(`  - Host: ${appConfig.host}`)
  console.log(`  - CORS Origin: ${appConfig.cors.origin}`)
  console.log(`  - LOG_LEVEL: ${process.env.LOG_LEVEL || 'info'}`)
  console.log(`  - PROD_SUMMARY_LOG_ONLY: ${process.env.PROD_SUMMARY_LOG_ONLY ?? '(unset, defaults to true in production)'}`)
  console.log(`  - ENABLE_HISTORY_DB: ${process.env.ENABLE_HISTORY_DB || 'false'}`)
  console.log(`  - ENABLE_STUDIO_DB: ${process.env.ENABLE_STUDIO_DB || 'false'}`)
}
