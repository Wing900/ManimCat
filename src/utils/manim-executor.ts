import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '../shared/logging/logger'
import { buildManimGxInvocation } from '../rendering/manim/manimgx-runtime'
import {
  assertRegularNonSymlinkFile,
  assertSandboxAvailable,
  copyVerifiedRegularFile,
  resolvePythonRuntime,
  spawnSandboxedProcess,
  stageNarrationForSandbox,
  terminateSandboxProcess,
  type SandboxInvocationInput
} from '../rendering/sandbox'
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

interface PreparedManimSandbox {
  rootDirectory: string
  outputDirectory: string
  hostOutputPath: string
  hostSyncReportPath?: string
  sandboxSyncReportPath?: string
  invocation: SandboxInvocationInput
}

function prepareManimSandbox(
  codeFile: string,
  options: ReturnType<typeof normalizeExecuteOptions>
): PreparedManimSandbox {
  assertSandboxAvailable()
  const runtime = resolvePythonRuntime({ envName: 'MANIMGX_PYTHON' })
  const rootDirectory = path.join(options.tempDir, 'sandbox')
  const inputDirectory = path.join(rootDirectory, 'input')
  const workDirectory = path.join(rootDirectory, 'work')
  const outputDirectory = path.join(rootDirectory, 'output')

  try {
    fs.rmSync(rootDirectory, { recursive: true, force: true })
    for (const directory of [
      inputDirectory,
      workDirectory,
      outputDirectory,
      path.join(workDirectory, 'home'),
      path.join(workDirectory, '.cache'),
      path.join(workDirectory, '.config'),
      path.join(workDirectory, '.local', 'share'),
    ]) {
      fs.mkdirSync(directory, { recursive: true })
    }

    copyVerifiedRegularFile(codeFile, path.join(inputDirectory, 'scene.py'))

    const hostOutputPath = path.resolve(options.mediaDir, `output.${options.format}`)
    const hostSyncReportPath = options.narrationSyncReportPath
      ? path.resolve(options.narrationSyncReportPath)
      : undefined
    fs.rmSync(hostOutputPath, { force: true })
    if (hostSyncReportPath) {
      fs.rmSync(hostSyncReportPath, { force: true })
    }

    if (options.narrationSyncReportPath && !options.narrationManifestPath) {
      throw new Error('A narration sync report requires a narration manifest')
    }

    const stagedNarration = options.narrationManifestPath
      ? stageNarrationForSandbox({
          inputDirectory,
          manifestPath: options.narrationManifestPath,
          syncReportPath: options.narrationSyncReportPath,
        })
      : undefined

    const invocation = buildManimGxInvocation({
      python: runtime.executable,
      codeFile: '/input/scene.py',
      outputPath: `/output/output.${options.format}`,
      quality: options.quality,
      frameRate: options.frameRate,
      format: options.format,
      sceneName: options.sceneName,
      narrationManifestPath: stagedNarration?.manifestPath,
      narrationSyncReportPath: stagedNarration?.syncReportPath,
    })

    return {
      rootDirectory,
      outputDirectory,
      hostOutputPath,
      hostSyncReportPath,
      sandboxSyncReportPath: stagedNarration?.syncReportPath,
      invocation: {
        label: `manim-${options.jobId}`,
        executable: invocation.python,
        args: invocation.args,
        cwd: '/work',
        inputDirectory,
        workDirectory,
        outputDirectory,
        runtimeDirectories: runtime.mountDirectories,
        pathEntries: runtime.pathEntries,
        readOnlyFiles: [
          {
            source: path.resolve('src/rendering/manim/manimgx-runner.py'),
            destination: '/runner/manimgx-runner.py',
          },
          {
            source: path.resolve('src/rendering/manim/narration_runtime.py'),
            destination: '/runner/narration_runtime.py',
          },
        ],
        env: {
          MPLCONFIGDIR: '/work/.config/matplotlib',
        },
      },
    }
  } catch (error) {
    // Never leak a partially staged sandbox if any setup step fails.
    fs.rmSync(rootDirectory, { recursive: true, force: true })
    throw error
  }
}

function publishManimArtifacts(
  prepared: PreparedManimSandbox,
  format: 'mp4' | 'png',
  jobId: string
): void {
  const sandboxOutput = path.join(prepared.outputDirectory, `output.${format}`)
  assertRegularNonSymlinkFile(sandboxOutput, 'Manim output artifact')
  copyVerifiedRegularFile(sandboxOutput, prepared.hostOutputPath)

  if (prepared.hostSyncReportPath && prepared.sandboxSyncReportPath) {
    const sandboxReport = path.join(prepared.outputDirectory, 'sync-report.json')
    try {
      assertRegularNonSymlinkFile(sandboxReport, 'Narration sync report', { allowEmpty: true })
      copyVerifiedRegularFile(sandboxReport, prepared.hostSyncReportPath, { allowEmpty: true })
    } catch (error) {
      // The report is diagnostic; a render must not succeed with a fabricated report.
      logger.warn(`Job ${jobId}: narration sync report was not exported`, {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export function executeManimCommand(
  codeFile: string,
  options: ManimExecuteOptions
): Promise<ManimExecutionResult> {
  const normalizedOptions = normalizeExecuteOptions(options)
  const state = createExecutionState()

  let prepared: PreparedManimSandbox
  try {
    prepared = prepareManimSandbox(codeFile, normalizedOptions)
  } catch (error) {
    fs.rmSync(path.join(normalizedOptions.tempDir, 'sandbox'), { recursive: true, force: true })
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Job ${normalizedOptions.jobId}: render sandbox refused to start`, {
      error: message,
    })
    return Promise.resolve(buildResult(false, state, message))
  }

  logger.info(`Job ${normalizedOptions.jobId}: starting sandboxed ManimGX process`, {
    runtime: prepared.invocation.executable,
    args: (prepared.invocation.args ?? []).join(' '),
    cwd: prepared.invocation.cwd,
  })

  return new Promise((resolve) => {
    const startTime = Date.now()
    const processGroup = process.platform !== 'win32'
    let proc: ReturnType<typeof spawnSandboxedProcess>
    try {
      proc = spawnSandboxedProcess(prepared.invocation)
    } catch (error) {
      fs.rmSync(prepared.rootDirectory, { recursive: true, force: true })
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Job ${normalizedOptions.jobId}: sandbox failed to start`, { error: message })
      resolve(buildResult(false, state, message))
      return
    }

    registerManimProcess(normalizedOptions.jobId, proc, processGroup)

    const memoryMonitor = startMemoryMonitor(proc, normalizedOptions, state)
    let timeoutTimer: NodeJS.Timeout | null = null
    let settled = false
    let fatalErrorDetected = false
    let cancellationTimer: NodeJS.Timeout | null = null
    let cancellationReadPending = false

    type TerminationReason =
      | { kind: 'timeout'; message: string }
      | { kind: 'fatal' }
      | { kind: 'cancelled' }
    let terminationReason: TerminationReason | null = null
    let forceSettleTimer: NodeJS.Timeout | null = null

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
      if (forceSettleTimer) clearTimeout(forceSettleTimer)
      unregisterManimProcess(normalizedOptions.jobId)
      fs.rmSync(prepared.rootDirectory, { recursive: true, force: true })
      resolve(result)
    }

    const terminationResult = (
      reason: TerminationReason,
      exitCode?: number
    ): ManimExecutionResult => {
      if (reason.kind === 'timeout') return buildResult(false, state, reason.message, exitCode)
      if (reason.kind === 'cancelled') return buildResult(false, state, 'Job cancelled', exitCode)
      return buildResult(false, state, undefined, exitCode)
    }

    const requestTermination = (reason: TerminationReason): void => {
      if (settled || terminationReason) return
      terminationReason = reason
      terminateManimProcess(normalizedOptions.jobId)
      // Do not remove the mounted /work and /output trees while bwrap or its
      // descendants are still alive. Wait for close, with a bounded fallback.
      forceSettleTimer = setTimeout(() => {
        if (!settled) settle(terminationResult(reason))
      }, 5_000)
      forceSettleTimer.unref?.()
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

    proc.stdout?.on('data', (data) => {
      handleStdoutData(state, normalizedOptions.jobId, data.toString())
    })

    proc.stderr?.on('data', (data) => {
      handleStderrData(state, normalizedOptions.jobId, data.toString())
      if (!fatalErrorDetected && FATAL_MANIM_ERROR_PATTERN.test(state.stderr.slice(-16_000))) {
        fatalErrorDetected = true
        logger.error(`Job ${normalizedOptions.jobId}: fatal Manim runtime error, terminating process tree`, {
          peakMemoryMB: state.peakMemoryMB,
          stderrPreview: state.stderr.slice(-1000),
        })
        requestTermination({ kind: 'fatal' })
      }
    })

    timeoutTimer = setTimeout(() => {
      const elapsed = elapsedSeconds(startTime)

      logger.warn(`Job ${normalizedOptions.jobId}: manim render timeout (${elapsed}s), killing process`, {
        peakMemoryMB: state.peakMemoryMB
      })

      requestTermination({
        kind: 'timeout',
        message: state.stderr || `Manim render timeout (${Math.round(normalizedOptions.timeoutMs / 1000)} seconds)`,
      })
    }, normalizedOptions.timeoutMs)

    proc.on('close', (code) => {
      if (settled) return
      const elapsed = elapsedSeconds(startTime)
      const cancelled = wasManimProcessCancelled(normalizedOptions.jobId)

      if (cancelled || terminationReason?.kind === 'cancelled') {
        logger.warn(`Job ${normalizedOptions.jobId}: Manim cancelled`, { elapsed: `${elapsed}s` })
        settle(buildResult(false, state, 'Job cancelled', code ?? undefined))
        return
      }

      if (terminationReason) {
        settle(terminationResult(terminationReason, code ?? undefined))
        return
      }

      // bwrap owns a PID namespace, but explicitly reap its process group before
      // any output is exported so a background child cannot keep writing artifacts.
      terminateSandboxProcess(proc)

      if (code === 0) {
        try {
          publishManimArtifacts(prepared, normalizedOptions.format, normalizedOptions.jobId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.error(`Job ${normalizedOptions.jobId}: sandbox output rejected`, { error: message })
          settle(buildResult(false, state, message, code))
          return
        }

        logger.info(`Job ${normalizedOptions.jobId}: manim completed`, {
          elapsed: `${elapsed}s`,
          exitCode: code,
          stdoutLength: state.stdout.length,
          stderrLength: state.stderr.length,
          peakMemoryMB: state.peakMemoryMB
        })
        settle({ ...buildResult(true, state, undefined, code), outputPath: prepared.hostOutputPath })
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

      if (cancelled || terminationReason?.kind === 'cancelled') {
        logger.warn(`Job ${normalizedOptions.jobId}: Manim cancelled`, { elapsed: `${elapsed}s` })
        requestTermination({ kind: 'cancelled' })
        return
      }

      if (terminationReason) {
        // The close handler or bounded fallback owns the result.
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
