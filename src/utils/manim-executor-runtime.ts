import { spawn } from 'child_process'
import { createLogger } from './logger'
import { getProcessMemory } from './process-memory'
import type { ManimExecuteOptions, ManimExecutionResult } from './manim-executor'

const logger = createLogger('ManimExecutorRuntime')

const STDOUT_LOG_INTERVAL_MS = 5000
const PROGRESS_LOG_INTERVAL_MS = 3000
const MEMORY_MONITOR_INTERVAL_MS = 2000

const RESOLUTION_MAP: Record<string, { width: number; height: number }> = {
  low: { width: 854, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 }
}

export interface NormalizedExecuteOptions {
  jobId: string
  quality: string
  frameRate: number
  format: 'mp4' | 'png'
  sceneName: string
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
}

export function normalizeExecuteOptions(options: ManimExecuteOptions): NormalizedExecuteOptions {
  return {
    jobId: options.jobId,
    quality: options.quality,
    frameRate: options.frameRate ?? 15,
    format: options.format ?? 'mp4',
    sceneName: options.sceneName ?? 'MainScene',
    tempDir: options.tempDir,
    mediaDir: options.mediaDir,
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000
  }
}

export function buildManimArgs(codeFile: string, options: NormalizedExecuteOptions): string[] {
  const resolution = RESOLUTION_MAP[options.quality] || RESOLUTION_MAP.medium
  const args = [
    'render',
    '--format',
    options.format,
    '--fps',
    options.frameRate.toString(),
    '--resolution',
    `${resolution.width},${resolution.height}`,
    '--media_dir',
    options.mediaDir
  ]

  if (options.format === 'png') {
    args.push('-s')
  }

  args.push(codeFile, options.sceneName)
  return args
}

export function createExecutionState(): ExecutionState {
  const now = Date.now()
  return {
    stdout: '',
    stderr: '',
    peakMemoryMB: 0,
    lastProgressLogAt: now,
    lastStdoutLogAt: now
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

    logger.info(`Job ${options.jobId}: Manim 内存使用（进程树总和）`, {
      memoryMB: memory,
      peakMemoryMB: state.peakMemoryMB
    })
  }, MEMORY_MONITOR_INTERVAL_MS)
}

export function handleStdoutData(state: ExecutionState, jobId: string, text: string): void {
  state.stdout += text

  const elapsedSinceLastStdoutLog = Date.now() - state.lastStdoutLogAt
  if (elapsedSinceLastStdoutLog > STDOUT_LOG_INTERVAL_MS) {
    logger.info(`Job ${jobId}: Manim 进度输出`, {
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
    logger.info(`Job ${jobId}: 渲染进度`, { progress: text.trim() })
    state.lastProgressLogAt = Date.now()
  }
}

export function handleStderrData(state: ExecutionState, jobId: string, text: string): void {
  state.stderr += text
  logger.info(`Job ${jobId}: Manim stderr 实时输出`, {
    output: text.trim(),
    totalStderrLength: state.stderr.length
  })
}

export function elapsedSeconds(startTime: number): string {
  return ((Date.now() - startTime) / 1000).toFixed(1)
}

export function buildResult(
  success: boolean,
  state: ExecutionState,
  stderrOverride?: string
): ManimExecutionResult {
  return {
    success,
    stdout: state.stdout,
    stderr: stderrOverride ?? state.stderr,
    peakMemoryMB: state.peakMemoryMB
  }
}
