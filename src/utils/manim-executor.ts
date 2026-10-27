import { spawn } from 'child_process'
import fs from 'node:fs'
import { createLogger } from '../shared/logging/logger'
import { buildManimGxCommand } from '../rendering/manim/manimgx-runtime'
import {
  registerManimProcess,
  cancelManimProcess,
  terminateManimProcess,
  unregisterManimProcess,
  wasManimProcessCancelled
} from './manim-process-registry'
import {
  buildResult,
  createExecutionState,
  elapsedSeconds,
  handleStderrData,
  handleStdoutData,
  normalizeExecuteOptions,
  startMemoryMonitor
} from './manim-executor-runtime'

const logger = createLogger('ManimGXExecutor')
const FATAL_MANIM_ERROR_PATTERN = /(?:MemoryError:|Unable to allocate[^\r\n]*array|Fatal Python error:)/i

export interface ManimExecutionResult {
  success: boolean
  stdout: string
  stderr: string
  peakMemoryMB: number
  exitCode?: number
  outputPath?: string
}

export interface ManimExecuteOptions {
  jobId: string
  quality: string
  frameRate?: number
  format?: 'mp4' | 'png'
  sceneName?: string
  tempDir: string
  mediaDir: string
  timeoutMs?: number
  /** Server-generated narration manifest; only set when this video has a narration sidecar. */
  narrationManifestPath?: string
  /** Server-generated path where the runtime records measured cue timestamps. */
  narrationSyncReportPath?: string
  /** Injected queue marker reader, so the executor stays independent of Redis. */
  isCancelled?: () => Promise<boolean>
}

export function executeManimCommand(
  codeFile: string,
  options: ManimExecuteOptions
): Promise<ManimExecutionResult> {
  const normalizedOptions = normalizeExecuteOptions(options)
  const { command, args, outputPath } = buildManimGxCommand(codeFile, normalizedOptions)

  logger.info(`Job ${normalizedOptions.jobId}: starting ManimGX process`, {
    command: `${command} ${args.join(' ')}`,
    cwd: normalizedOptions.tempDir
  })

  return new Promise((resolve) => {
    const startTime = Date.now()
    const state = createExecutionState()
    const processGroup = process.platform !== 'win32'
    const proc = spawn(command, args, {
      cwd: normalizedOptions.tempDir,
      detached: processGroup,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    })

    registerManimProcess(normalizedOptions.jobId, proc, processGroup)

    const memoryMonitor = startMemoryMonitor(proc, normalizedOptions, state)
    let timeoutTimer: NodeJS.Timeout | null = null
    let settled = false
    let fatalErrorDetected = false
    let cancellationTimer: NodeJS.Timeout | null = null
    let cancellationReadPending = false

    const settle = (result: ManimExecutionResult): void => {
      if (settled) {
        return
      }
      settled = true

      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      clearInterval(memoryMonitor)
      if (cancellationTimer) clearInterval(cancellationTimer)
      unregisterManimProcess(normalizedOptions.jobId)
      resolve(result)
    }

    // A different API replica cannot kill this local process directly. Read the durable marker.
    if (options.isCancelled) {
      const checkCancellation = async () => {
        if (settled || cancellationReadPending) return
        cancellationReadPending = true
        try {
          const cancelled = await options.isCancelled!()
          if (cancelled && !settled) cancelManimProcess(normalizedOptions.jobId)
        } catch (error) {
          logger.warn('Unable to read render cancellation marker', { jobId: normalizedOptions.jobId, error: String(error) })
        } finally {
          cancellationReadPending = false
        }
      }
      cancellationTimer = setInterval(() => { void checkCancellation() }, 1000)
      void checkCancellation()
    }

    proc.stdout.on('data', (data) => {
      handleStdoutData(state, normalizedOptions.jobId, data.toString())
    })

    proc.stderr.on('data', (data) => {
      handleStderrData(state, normalizedOptions.jobId, data.toString())
      if (!fatalErrorDetected && FATAL_MANIM_ERROR_PATTERN.test(state.stderr.slice(-16_000))) {
        fatalErrorDetected = true
        logger.error(`Job ${normalizedOptions.jobId}: fatal Manim runtime error, terminating process tree`, {
          peakMemoryMB: state.peakMemoryMB,
          stderrPreview: state.stderr.slice(-1000),
        })
        terminateManimProcess(normalizedOptions.jobId)
        settle(buildResult(false, state))
      }
    })

    timeoutTimer = setTimeout(() => {
      const elapsed = elapsedSeconds(startTime)

      logger.warn(`Job ${normalizedOptions.jobId}: manim render timeout (${elapsed}s), killing process`, {
        peakMemoryMB: state.peakMemoryMB
      })

      terminateManimProcess(normalizedOptions.jobId)

      settle(
        buildResult(
          false,
          state,
          state.stderr || `Manim render timeout (${Math.round(normalizedOptions.timeoutMs / 1000)} seconds)`
        )
      )
    }, normalizedOptions.timeoutMs)

    proc.on('close', (code) => {
      if (settled) return
      const elapsed = elapsedSeconds(startTime)
      const cancelled = wasManimProcessCancelled(normalizedOptions.jobId)

      if (cancelled) {
        logger.warn(`Job ${normalizedOptions.jobId}: Manim cancelled`, { elapsed: `${elapsed}s` })
        settle(buildResult(false, state, 'Job cancelled', code ?? undefined))
        return
      }

      if (code === 0) {
        let hasOutput = false
        try {
          const output = fs.statSync(outputPath)
          hasOutput = output.isFile() && output.size > 0
        } catch {
          // A missing artifact must become a render failure, not an uncaught callback error.
        }
        if (!hasOutput) {
          settle(buildResult(false, state, `ManimGX completed without output: ${outputPath}`, code))
          return
        }
        logger.info(`Job ${normalizedOptions.jobId}: manim completed`, {
          elapsed: `${elapsed}s`,
          exitCode: code,
          stdoutLength: state.stdout.length,
          stderrLength: state.stderr.length,
          peakMemoryMB: state.peakMemoryMB
        })
        settle({ ...buildResult(true, state, undefined, code), outputPath })
        return
      }

      logger.error(`Job ${normalizedOptions.jobId}: manim exited with error`, {
        elapsed: `${elapsed}s`,
        exitCode: code,
        stdoutLength: state.stdout.length,
        stderrLength: state.stderr.length,
        stderrPreview: state.stderr.slice(-500),
        peakMemoryMB: state.peakMemoryMB
      })
      settle(buildResult(false, state, undefined, code ?? undefined))
    })

    proc.on('error', (error) => {
      const elapsed = elapsedSeconds(startTime)
      const cancelled = wasManimProcessCancelled(normalizedOptions.jobId)

      if (cancelled) {
        logger.warn(`Job ${normalizedOptions.jobId}: Manim cancelled`, { elapsed: `${elapsed}s` })
        settle(buildResult(false, state, 'Job cancelled'))
        return
      }

      logger.error(`Job ${normalizedOptions.jobId}: manim process start failed`, {
        elapsed: `${elapsed}s`,
        errorMessage: error.message,
        errorStack: error.stack
      })
      settle(buildResult(false, state, error.message))
    })
  })
}
