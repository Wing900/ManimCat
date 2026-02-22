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
    request: parseInt(process.env.REQUEST_TIMEOUT || '600000', 10),  // 请求超时 10 分钟
    job: parseInt(process.env.JOB_TIMEOUT || '600000', 10)          // 任务超时 10 分钟
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    pretty: process.env.NODE_ENV === 'development'
  },

  // OpenAI 配置
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'glm-4-flash',
    temperature: parseFloat(process.env.AI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '1200', 10),
    customApiUrl: process.env.CUSTOM_API_URL?.trim()
  },

  // Manim 配置
  manim: {
    quality: {
      low: '-ql',
      medium: '-qm',
      high: '-qh'
    },
    timeout: parseInt(process.env.MANIM_TIMEOUT || '600000', 10)  // 10 分钟
  },

  // 文件系统配置
  paths: {
    videos: process.env.VIDEO_OUTPUT_DIR || 'public/videos',
    temp: process.env.TEMP_DIR || 'temp'
  }
} as const

/**
 * 验证必需的环境变量
 */
export function validateConfig(): void {
  const required = ['OPENAI_API_KEY']
  const missing = required.filter(key => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
}

/**
 * 开发模式检查
 */
export function isDevelopment(): boolean {
  return appConfig.nodeEnv === 'development'
}

/**
 * 生产模式检查
 */
export function isProduction(): boolean {
  return appConfig.nodeEnv === 'production'
}

/**
 * 打印配置信息（隐藏敏感信息）
 */
export function printConfig(): void {
  console.log('📋 Application Configuration:')
  console.log(`  - Environment: ${appConfig.nodeEnv}`)
  console.log(`  - Port: ${appConfig.port}`)
  console.log(`  - Host: ${appConfig.host}`)
  console.log(`  - OpenAI Model: ${appConfig.openai.model}`)
  console.log(`  - CORS Origin: ${appConfig.cors.origin}`)
}
