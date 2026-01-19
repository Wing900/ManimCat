/**
 * Logger Utility
 * 统一日志工具，替代 Motia logger
 */

import { appConfig } from '../config/app'

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

/**
 * 日志级别映射
 */
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR
}

/**
 * 当前日志级别
 */
const currentLogLevel = LOG_LEVEL_MAP[appConfig.logging.level] || LogLevel.INFO

/**
 * 格式化时间戳
 */
function formatTimestamp(): string {
  return new Date().toISOString()
}

/**
 * 格式化日志消息
 */
function formatMessage(level: string, message: string, meta?: any): string {
  const timestamp = formatTimestamp()
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : ''
  
  if (appConfig.logging.pretty) {
    // 开发环境：带颜色的格式
    const colors: Record<string, string> = {
      DEBUG: '\x1b[36m',  // Cyan
      INFO: '\x1b[32m',   // Green
      WARN: '\x1b[33m',   // Yellow
      ERROR: '\x1b[31m'   // Red
    }
    const reset = '\x1b[0m'
    const color = colors[level] || ''
    
    return `${color}[${timestamp}] ${level}${reset}: ${message}${metaStr}`
  } else {
    // 生产环境：JSON 格式
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...meta
    })
  }
}

/**
 * Logger 类
 */
class Logger {
  private context?: string

  constructor(context?: string) {
    this.context = context
  }

  /**
   * 添加上下文信息
   */
  private addContext(meta?: any): any {
    if (!this.context) return meta
    return { ...meta, context: this.context }
  }

  /**
   * 调试日志
   */
  debug(message: string, meta?: any): void {
    if (currentLogLevel <= LogLevel.DEBUG) {
      console.debug(formatMessage('DEBUG', message, this.addContext(meta)))
    }
  }

  /**
   * 信息日志
   */
  info(message: string, meta?: any): void {
    if (currentLogLevel <= LogLevel.INFO) {
      console.log(formatMessage('INFO', message, this.addContext(meta)))
    }
  }

  /**
   * 警告日志
   */
  warn(message: string, meta?: any): void {
    if (currentLogLevel <= LogLevel.WARN) {
      console.warn(formatMessage('WARN', message, this.addContext(meta)))
    }
  }

  /**
   * 错误日志
   */
  error(message: string, meta?: any): void {
    if (currentLogLevel <= LogLevel.ERROR) {
      console.error(formatMessage('ERROR', message, this.addContext(meta)))
    }
  }

  /**
   * 创建子 logger 带上下文
   */
  child(context: string): Logger {
    const childContext = this.context ? `${this.context}:${context}` : context
    return new Logger(childContext)
  }
}

/**
 * 默认 logger 实例
 */
export const logger = new Logger()

/**
 * 创建带上下文的 logger
 */
export function createLogger(context: string): Logger {
  return new Logger(context)
}