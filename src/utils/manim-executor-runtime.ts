import { spawn } from 'child_process'
import { createLogger } from '../shared/logging/logger'
import { getProcessMemory } from '../shared/process-memory'
import type { ManimExecuteOptions, ManimExecutionResult } from './manim-executor'

const logger = createLogger('ManimExecutorRuntime')

const STDOUT_LOG_INTERVAL_MS = 5000
const PROGRESS_LOG_INTERVAL_MS = 3000
const STDERR_LOG_INTERVAL_MS = 10000
const MEMORY_MONITOR_INTERVAL_MS = 2000

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

const renderMemoryLogEnabled = parseBooleanEnv(process.env.RENDER_MEMORY_LOG_ENABLED) ?? false

export interface NormalizedExecuteOptions {
  jobId: string
  quality: string
  frameRate: number
  format: 'mp4' | 'png'
  sceneName?: string
  tempDir: string
  mediaDir: string
  timeoutMs: number
}

export interface ExecutionState {
  stdout: string
  stderr: string
  peakMemoryMB: number
  lastProgressLogAt: number
  lastStdoutLogAt: number
  lastStderrLogAt: number
}

export function normalizeExecuteOptions(options: ManimExecuteOptions): NormalizedExecuteOptions {
  return {
    jobId: options.jobId,
    quality: options.quality,
    frameRate: options.frameRate ?? 60,
    format: options.format ?? 'mp4',
    sceneName: options.sceneName,
    tempDir: options.tempDir,
    mediaDir: options.mediaDir,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000
  }
}

export function createExecutionState(): ExecutionState {
  const now = Date.now()
  return {
    stdout: '',
    stderr: '',
    peakMemoryMB: 0,
    lastProgressLogAt: now,
    lastStdoutLogAt: now,
    lastStderrLogAt: now
  }
}

export function startMemoryMonitor(
  proc: ReturnType<typeof spawn>,
  options: NormalizedExecuteOptions,
  state: ExecutionState
): NodeJS.Timeout {
  return setInterval(async () => {
    if (!proc.pid) {
      return
    }

    const memory = await getProcessMemory(proc.pid)
    if (memory === null) {
      return
    }

    if (memory > state.peakMemoryMB) {
      state.peakMemoryMB = memory
    }

    if (renderMemoryLogEnabled) {
      logger.info(`Job ${options.jobId}: Manim memory usage`, {
        memoryMB: memory,
        peakMemoryMB: state.peakMemoryMB
      })
    }
  }, MEMORY_MONITOR_INTERVAL_MS)
}

export function handleStdoutData(state: ExecutionState, jobId: string, text: string): void {
  state.stdout += text

  const elapsedSinceLastStdoutLog = Date.now() - state.lastStdoutLogAt
  if (elapsedSinceLastStdoutLog > STDOUT_LOG_INTERVAL_MS) {
    logger.info(`Job ${jobId}: Manim stdout`, {
      output: text.trim(),
      totalOutputLength: state.stdout.length
    })
    state.lastStdoutLogAt = Date.now()
  }

  if (!text.includes('%') && !text.includes('it/s')) {
    return
  }

  const elapsedSinceLastProgressLog = Date.now() - state.lastProgressLogAt
  if (elapsedSinceLastProgressLog > PROGRESS_LOG_INTERVAL_MS) {
    logger.info(`Job ${jobId}: Manim progress`, { progress: text.trim() })
    state.lastProgressLogAt = Date.now()
  }
}

export function handleStderrData(state: ExecutionState, jobId: string, text: string): void {
  state.stderr += text

  const trimmed = text.trim()
  if (!trimmed) {
    return
  }

  const isProgressLike = trimmed.includes('%') || trimmed.includes('it/s') || /animation\s+\d+/i.test(trimmed)
  const elapsedSinceLastStderrLog = Date.now() - state.lastStderrLogAt

  if (isProgressLike && elapsedSinceLastStderrLog < STDERR_LOG_INTERVAL_MS) {
    return
  }

  logger.info(`Job ${jobId}: Manim stderr`, {
    output: trimmed,
    totalStderrLength: state.stderr.length
  })
  state.lastStderrLogAt = Date.now()
}

export function elapsedSeconds(startTime: number): string {
  return ((Date.now() - startTime) / 1000).toFixed(1)
}

export function buildResult(
  success: boolean,
  state: ExecutionState,
  stderrOverride?: string,
  exitCode?: number
): ManimExecutionResult {
  return {
    success,
    stdout: state.stdout,
    stderr: stderrOverride ?? state.stderr,
    peakMemoryMB: state.peakMemoryMB,
    exitCode
  }
}
