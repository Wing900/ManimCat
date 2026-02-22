/**
 * Manim 执行器
 * 执行 Manim 命令，管理子进程
 */

import { spawn } from 'child_process'
import { createLogger } from './logger'
import {
  registerManimProcess,
  unregisterManimProcess,
  wasManimProcessCancelled
} from './manim-process-registry'
import {
  buildManimArgs,
  buildResult,
  createExecutionState,
  elapsedSeconds,
  handleStderrData,
  handleStdoutData,
  normalizeExecuteOptions,
  startMemoryMonitor
} from './manim-executor-runtime'

const logger = createLogger('ManimExecutor')

/**
 * Manim 执行结果
 */
export interface ManimExecutionResult {
  success: boolean
  stdout: string
  stderr: string
  peakMemoryMB: number
}

/**
 * Manim 执行选项
 */
export interface ManimExecuteOptions {
  jobId: string
  quality: string
  frameRate?: number
  format?: 'mp4' | 'png'
  sceneName?: string
  tempDir: string
  mediaDir: string
  timeoutMs?: number
}

/**
 * 执行 manim 命令
 */
export function executeManimCommand(
  codeFile: string,
  options: ManimExecuteOptions
): Promise<ManimExecutionResult> {
  const normalizedOptions = normalizeExecuteOptions(options)
  const args = buildManimArgs(codeFile, normalizedOptions)

  logger.info(`Job ${normalizedOptions.jobId}: 启动 manim 进程`, {
    command: `manim ${args.join(' ')}`,
    cwd: normalizedOptions.tempDir
  })

  return new Promise((resolve) => {
    const startTime = Date.now()
    const state = createExecutionState()
    const proc = spawn('manim', args, { cwd: normalizedOptions.tempDir })

    registerManimProcess(normalizedOptions.jobId, proc)

    const memoryMonitor = startMemoryMonitor(proc, normalizedOptions, state)
    let timeoutTimer: NodeJS.Timeout | null = null
    let settled = false

    const settle = (result: ManimExecutionResult): void => {
      if (settled) {
        return
      }
      settled = true

      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      clearInterval(memoryMonitor)
      unregisterManimProcess(normalizedOptions.jobId)
      resolve(result)
    }

    proc.stdout.on('data', (data) => {
      handleStdoutData(state, normalizedOptions.jobId, data.toString())
    })

    proc.stderr.on('data', (data) => {
      handleStderrData(state, normalizedOptions.jobId, data.toString())
    })

    timeoutTimer = setTimeout(() => {
      const elapsed = elapsedSeconds(startTime)

      logger.warn(`Job ${normalizedOptions.jobId}: Manim render timeout (${elapsed}s), killing process`, {
        peakMemoryMB: state.peakMemoryMB
      })

      proc.kill('SIGKILL')

      settle(
        buildResult(
          false,
          state,
          state.stderr || `Manim render timeout (${Math.round(normalizedOptions.timeoutMs / 1000)} seconds)`
        )
      )
    }, normalizedOptions.timeoutMs)

    proc.on('close', (code) => {
      const elapsed = elapsedSeconds(startTime)
      const cancelled = wasManimProcessCancelled(normalizedOptions.jobId)

      if (cancelled) {
        logger.warn(`Job ${normalizedOptions.jobId}: Manim cancelled`, { elapsed: `${elapsed}s` })
        settle(buildResult(false, state, 'Job cancelled'))
        return
      }

      if (code === 0) {
        logger.info(`Job ${normalizedOptions.jobId}: Manim 成功完成`, {
          elapsed: `${elapsed}s`,
          exitCode: code,
          stdoutLength: state.stdout.length,
          stderrLength: state.stderr.length,
          peakMemoryMB: state.peakMemoryMB
        })
        settle(buildResult(true, state))
        return
      }

      logger.error(`Job ${normalizedOptions.jobId}: Manim 退出异常`, {
        elapsed: `${elapsed}s`,
        exitCode: code,
        stdoutLength: state.stdout.length,
        stderrLength: state.stderr.length,
        stderrPreview: state.stderr.slice(-500),
        peakMemoryMB: state.peakMemoryMB
      })
      settle(buildResult(false, state))
    })

    proc.on('error', (error) => {
      const elapsed = elapsedSeconds(startTime)
      const cancelled = wasManimProcessCancelled(normalizedOptions.jobId)

      if (cancelled) {
        logger.warn(`Job ${normalizedOptions.jobId}: Manim cancelled`, { elapsed: `${elapsed}s` })
        settle(buildResult(false, state, 'Job cancelled'))
        return
      }

      logger.error(`Job ${normalizedOptions.jobId}: Manim 进程启动失败`, {
        elapsed: `${elapsed}s`,
        errorMessage: error.message,
        errorStack: error.stack
      })
      settle(buildResult(false, state, error.message))
    })
  })
}
