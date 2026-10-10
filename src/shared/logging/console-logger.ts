/**
 * Logger interface and console-based implementation.
 */

import { serializeError } from './serialize-error'

export interface Logger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const

function readLogLevel(): keyof typeof LOG_LEVEL_PRIORITY {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase()
  if (env in LOG_LEVEL_PRIORITY) return env as keyof typeof LOG_LEVEL_PRIORITY
  return 'info'
}

const configuredLevel = readLogLevel()

function shouldLog(level: keyof typeof LOG_LEVEL_PRIORITY): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel]
}

function formatEntry(context: string | null, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString()
  const ctx = context ? ` [${context}]` : ''
  if (data && typeof data === 'object' && Object.keys(data as object).length > 0) {
    return `${timestamp}${ctx} ${message} ${JSON.stringify(data)}`
  }
  return `${timestamp}${ctx} ${message}`
}

function extractErrorRecord(data?: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return data as Record<string, unknown> | undefined
  const record = data as Record<string, unknown>
  if (record.error instanceof Error) {
    return { ...record, error: serializeError(record.error) }
  }
  return record
}

export class ConsoleLogger implements Logger {
  constructor(private readonly context: string | null = null) {}

  debug(message: string, data?: unknown): void {
    if (!shouldLog('debug')) return
    console.debug(formatEntry(this.context, message, extractErrorRecord(data)))
  }

  info(message: string, data?: unknown): void {
    if (!shouldLog('info')) return
    console.info(formatEntry(this.context, message, extractErrorRecord(data)))
  }

  warn(message: string, data?: unknown): void {
    if (!shouldLog('warn')) return
    console.warn(formatEntry(this.context, message, extractErrorRecord(data)))
  }

  error(message: string, data?: unknown): void {
    if (!shouldLog('error')) return
    console.error(formatEntry(this.context, message, extractErrorRecord(data)))
  }
}
