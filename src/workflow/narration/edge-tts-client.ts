/**
 * Spawn boundary between TypeScript and the online Edge TTS worker.
 *
 * Input is a single JSON object on stdin; output is a single JSON object on stdout.
 * Diagnostics go to stderr. The worker never receives credentials because the
 * Edge endpoint is keyless. Cancellation kills the whole child process group, so
 * in-flight HTTP requests do not outlive a cancelled render.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '../../shared/logging/logger'
import { NarrationError, createCancellationError } from './narration-error'
import type { EdgeWordBoundary } from './text-alignment'

const logger = createLogger('NarrationEdgeTts')

export const EDGE_TTS_TICKS_PER_SECOND = 10_000_000
export const EDGE_TTS_WORKER_VERSION = '2-edge-tts-7.3.1'
export const NARRATION_SAMPLE_RATE = 24_000
export const NARRATION_CHANNELS = 1
export const DEFAULT_TTS_CONCURRENCY = 3
export const DEFAULT_WORKER_TIMEOUT_SECONDS = 180

const MAX_STDOUT_BYTES = 16 * 1024 * 1024
const MAX_STDERR_CHARS = 64 * 1024

export interface EdgeTtsSegmentInput {
  id: string
  /** Spoken text with cue markers already removed. */
  text: string
  voice: string
  rate: string
}

export interface EdgeTtsSegmentResult {
  id: string
  wavPath: string
  duration: number
  frames: number
  sampleRate: number
  channels: number
  boundaries: EdgeWordBoundary[]
}

export interface RunEdgeTtsWorkerOptions {
  outputDirectory: string
  segments: readonly EdgeTtsSegmentInput[]
  concurrency?: number
  signal?: AbortSignal
  pythonPath?: string
  workerScriptPath?: string
  timeoutSeconds?: number
  ffmpegPath?: string
  ffprobePath?: string
  env?: NodeJS.ProcessEnv
}

interface WorkerFailurePayload {
  code?: unknown
  message?: unknown
  segmentId?: unknown
}

function isExecutableFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

function looksLikePath(command: string): boolean {
  return command.includes('/') || command.includes('\\') || /^[A-Za-z]:/.test(command)
}

/**
 * Choose the interpreter that has ``edge-tts`` installed.
 *
 * Production installs requirements into the render Python environment, which the
 * caller can pass explicitly or expose as NARRATION_PYTHON / MANIMGX_PYTHON.
 * A local worktree ``.venv`` is used for development; otherwise PATH owns it.
 */
export function resolveNarrationPython(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const chosen = explicit?.trim()
  if (chosen) {
    if (!looksLikePath(chosen) || isExecutableFile(chosen)) {
      return chosen
    }
    throw new NarrationError(
      'WORKER_FAILED',
      `Configured narration Python does not exist: ${chosen}`,
      { python: chosen }
    )
  }

  for (const key of ['NARRATION_PYTHON', 'MANIMGX_PYTHON'] as const) {
    const candidate = env[key]?.trim()
    if (!candidate) continue
    if (!looksLikePath(candidate)) {
      return candidate
    }
    if (isExecutableFile(candidate)) {
      return candidate
    }
    throw new NarrationError(
      'WORKER_FAILED',
      `${key} points to a missing narration Python: ${candidate}`,
      { python: candidate, env: key }
    )
  }

  const localPython = path.resolve(
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  )
  if (isExecutableFile(localPython)) {
    return localPython
  }
  return 'python'
}

export function resolveEdgeTtsWorkerScript(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const candidate = explicit || env.NARRATION_EDGE_TTS_WORKER || path.resolve('src/rendering/manim/edge_tts_worker.py')
  const resolved = path.resolve(candidate)
  if (!isExecutableFile(resolved)) {
    throw new NarrationError(
      'WORKER_MISSING',
      `Edge TTS worker script not found: ${resolved}. Copy edge_tts_worker.py with the Manim runner and install requirements.txt.`,
      { workerScriptPath: resolved }
    )
  }
  return resolved
}

function tail(value: string, max = 2000): string {
  return value.length <= max ? value : value.slice(-max)
}

function resolveConcurrency(value: number | undefined, env: NodeJS.ProcessEnv): number {
  const fromEnv = Number(env.NARRATION_TTS_CONCURRENCY ?? DEFAULT_TTS_CONCURRENCY)
  const requested = value ?? (Number.isFinite(fromEnv) ? fromEnv : DEFAULT_TTS_CONCURRENCY)
  const finite = Number.isFinite(requested) ? requested : DEFAULT_TTS_CONCURRENCY
  return Math.max(1, Math.min(DEFAULT_TTS_CONCURRENCY, Math.floor(finite)))
}

function normalizeBoundary(value: unknown, segmentId: string, index: number): EdgeWordBoundary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NarrationError('TTS_FAILED', `Worker returned invalid boundary ${index} for ${segmentId}`, {
      segmentId,
      boundaryIndex: index
    })
  }
  const record = value as { text?: unknown; offsetTicks?: unknown; durationTicks?: unknown }
  if (typeof record.text !== 'string') {
    throw new NarrationError('TTS_FAILED', `Worker boundary text is not a string for ${segmentId}`, {
      segmentId,
      boundaryIndex: index
    })
  }
  const offsetTicks = record.offsetTicks
  const durationTicks = record.durationTicks
  if (
    typeof offsetTicks !== 'number' ||
    !Number.isSafeInteger(offsetTicks) ||
    offsetTicks < 0 ||
    typeof durationTicks !== 'number' ||
    !Number.isSafeInteger(durationTicks) ||
    durationTicks < 0
  ) {
    throw new NarrationError(
      'TTS_FAILED',
      `Worker boundary tick values are invalid for ${segmentId}; expected integer 100 ns ticks`,
      { segmentId, boundaryIndex: index, offsetTicks, durationTicks }
    )
  }
  return { text: record.text, offsetTicks, durationTicks }
}

function validateWorkerResult(
  payload: unknown,
  options: RunEdgeTtsWorkerOptions
): EdgeTtsSegmentResult[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new NarrationError('WORKER_FAILED', 'Edge TTS worker returned a non-object result')
  }
  const record = payload as {
    ok?: unknown
    workerVersion?: unknown
    tickRate?: unknown
    sampleRate?: unknown
    channels?: unknown
    segments?: unknown
    error?: WorkerFailurePayload
  }

  if (record.ok !== true) {
    const failure = record.error ?? {}
    const code = typeof failure.code === 'string' ? failure.code : 'TTS_FAILED'
    const message = typeof failure.message === 'string' ? failure.message : 'Edge TTS worker failed'
    const segmentId = typeof failure.segmentId === 'string' ? failure.segmentId : undefined
    throw new NarrationError('TTS_FAILED', `Edge TTS failed (${code}): ${message}`, {
      workerCode: code,
      segmentId
    })
  }

  if (record.workerVersion !== EDGE_TTS_WORKER_VERSION) {
    throw new NarrationError(
      'WORKER_FAILED',
      `Edge TTS worker version mismatch: got ${String(record.workerVersion)}, expected ${EDGE_TTS_WORKER_VERSION}`,
      { workerVersion: record.workerVersion }
    )
  }

  if (record.tickRate !== EDGE_TTS_TICKS_PER_SECOND) {
    throw new NarrationError(
      'TTS_FAILED',
      `Edge TTS boundary unit mismatch: worker reported ${String(record.tickRate)} ticks/second, expected ${EDGE_TTS_TICKS_PER_SECOND}`,
      { tickRate: record.tickRate }
    )
  }
  if (record.sampleRate !== NARRATION_SAMPLE_RATE || record.channels !== NARRATION_CHANNELS) {
    throw new NarrationError(
      'TTS_FAILED',
      `Worker audio format ${String(record.sampleRate)}Hz/${String(record.channels)}ch != ${NARRATION_SAMPLE_RATE}Hz/${NARRATION_CHANNELS}ch`,
      { sampleRate: record.sampleRate, channels: record.channels }
    )
  }
  if (!Array.isArray(record.segments) || record.segments.length !== options.segments.length) {
    throw new NarrationError(
      'WORKER_FAILED',
      `Worker returned ${Array.isArray(record.segments) ? record.segments.length : 'no'} segments; expected ${options.segments.length}`
    )
  }

  const outputRoot = path.resolve(options.outputDirectory)
  const results: EdgeTtsSegmentResult[] = []
  for (let index = 0; index < record.segments.length; index += 1) {
    const value = record.segments[index]
    const expectedId = options.segments[index].id
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new NarrationError('WORKER_FAILED', `Worker segment ${index} is not an object`, {
        segmentId: expectedId
      })
    }
    const segment = value as {
      id?: unknown
      wavPath?: unknown
      duration?: unknown
      frames?: unknown
      sampleRate?: unknown
      channels?: unknown
      boundaries?: unknown
      source?: { codec?: unknown }
    }
    if (segment.id !== expectedId) {
      throw new NarrationError(
        'WORKER_FAILED',
        `Worker segment order mismatch at ${index}: got ${JSON.stringify(segment.id)}, expected ${JSON.stringify(expectedId)}`,
        { expectedId, actualId: segment.id }
      )
    }
    if (typeof segment.wavPath !== 'string' || !segment.wavPath.trim()) {
      throw new NarrationError('WORKER_FAILED', `Worker did not return a WAV path for ${expectedId}`, {
        segmentId: expectedId
      })
    }
    const wavPath = path.resolve(segment.wavPath)
    const relative = path.relative(outputRoot, wavPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new NarrationError('WORKER_FAILED', `Worker WAV path escapes the narration workspace: ${wavPath}`, {
        segmentId: expectedId,
        wavPath
      })
    }
    if (!isExecutableFile(wavPath)) {
      throw new NarrationError('WORKER_FAILED', `Worker WAV file is missing: ${wavPath}`, {
        segmentId: expectedId,
        wavPath
      })
    }
    if (typeof segment.duration !== 'number' || !(segment.duration > 0) || !Number.isFinite(segment.duration)) {
      throw new NarrationError('WORKER_FAILED', `Worker returned invalid duration for ${expectedId}`, {
        segmentId: expectedId,
        duration: segment.duration
      })
    }
    if (
      typeof segment.frames !== 'number' ||
      !Number.isSafeInteger(segment.frames) ||
      segment.frames <= 0
    ) {
      throw new NarrationError('WORKER_FAILED', `Worker returned invalid frame count for ${expectedId}`, {
        segmentId: expectedId,
        frames: segment.frames
      })
    }
    if (segment.sampleRate !== NARRATION_SAMPLE_RATE || segment.channels !== NARRATION_CHANNELS) {
      throw new NarrationError(
        'WORKER_FAILED',
        `Worker segment ${expectedId} has ${String(segment.sampleRate)}Hz/${String(segment.channels)}ch; expected ${NARRATION_SAMPLE_RATE}Hz/${NARRATION_CHANNELS}ch`,
        { segmentId: expectedId }
      )
    }
    if (segment.source?.codec !== undefined && segment.source.codec !== 'mp3') {
      throw new NarrationError(
        'WORKER_FAILED',
        `Edge response for ${expectedId} was not decoded MP3 (codec ${String(segment.source.codec)})`,
        { segmentId: expectedId }
      )
    }
    if (!Array.isArray(segment.boundaries)) {
      throw new NarrationError('WORKER_FAILED', `Worker returned no boundary array for ${expectedId}`, {
        segmentId: expectedId
      })
    }
    const boundaries = segment.boundaries.map((boundary, boundaryIndex) =>
      normalizeBoundary(boundary, expectedId, boundaryIndex)
    )
    results.push({
      id: expectedId,
      wavPath,
      duration: segment.duration,
      frames: segment.frames,
      sampleRate: segment.sampleRate,
      channels: segment.channels,
      boundaries
    })
  }

  return results
}

/**
 * Run the worker over the segments that are not in the cache.
 *
 * The worker itself enforces a concurrency cap of 3. Results are returned in plan
 * order even when synthesis finishes out of order.
 */
export async function runEdgeTtsWorker(
  options: RunEdgeTtsWorkerOptions
): Promise<EdgeTtsSegmentResult[]> {
  if (options.segments.length === 0) {
    return []
  }
  if (options.signal?.aborted) {
    throw createCancellationError(options.signal)
  }

  const env = options.env ?? process.env
  const python = resolveNarrationPython(options.pythonPath, env)
  const workerScript = resolveEdgeTtsWorkerScript(options.workerScriptPath, env)
  const outputDirectory = path.resolve(options.outputDirectory)
  const concurrency = resolveConcurrency(options.concurrency, env)
  const timeoutSeconds =
    options.timeoutSeconds && options.timeoutSeconds > 0
      ? options.timeoutSeconds
      : Number(env.NARRATION_TTS_TIMEOUT_SECONDS ?? DEFAULT_WORKER_TIMEOUT_SECONDS) ||
        DEFAULT_WORKER_TIMEOUT_SECONDS

  const input = {
    outputDirectory,
    concurrency,
    sampleRate: NARRATION_SAMPLE_RATE,
    timeoutSeconds,
    segments: options.segments.map((segment) => ({
      id: segment.id,
      text: segment.text,
      voice: segment.voice,
      rate: segment.rate
    })),
    ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
    ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {})
  }

  logger.info('Calling Edge TTS worker', {
    python,
    segments: options.segments.length,
    concurrency,
    voice: options.segments[0]?.voice,
    rate: options.segments[0]?.rate
  })

  return await new Promise<EdgeTtsSegmentResult[]>((resolve, reject) => {
    let stdout = Buffer.alloc(0)
    let stderr = ''
    let settled = false
    let killTimer: NodeJS.Timeout | undefined
    let aborted = false
    let exited = false

    const child = spawn(python, ['-u', workerScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // POSIX: a detached process group lets cancellation kill any FFmpeg child too.
      detached: process.platform !== 'win32',
      env
    })

    const cleanup = (): void => {
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = undefined
      }
      options.signal?.removeEventListener('abort', handleAbort)
    }

    const settle = (error?: Error, value?: EdgeTtsSegmentResult[]): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(value ?? [])
    }

    const killChild = (): void => {
      if (child.killed) return
      // On Windows child.kill() leaves FFmpeg grandchildren alive; taskkill /T
      // removes the whole tree so workspace cleanup cannot race an open file.
      if (process.platform === 'win32' && child.pid) {
        try {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true
          })
          killer.on('error', () => undefined)
        } catch {
          // Fall through to child.kill() below.
        }
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          // Fall through to child.kill() below.
        }
      }
      try {
        child.kill('SIGTERM')
      } catch {
        return
      }
      killTimer = setTimeout(() => {
        if (!exited) {
          try {
            if (process.platform === 'win32' && child.pid) {
              spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
                stdio: 'ignore',
                windowsHide: true
              }).on('error', () => undefined)
            } else if (child.pid) {
              process.kill(-child.pid, 'SIGKILL')
            }
          } catch {
            try {
              child.kill('SIGKILL')
            } catch {
              // The process is already gone.
            }
          }
        }
      }, 2000)
      killTimer.unref?.()
    }

    const handleAbort = (): void => {
      aborted = true
      killChild()
    }

    options.signal?.addEventListener('abort', handleAbort, { once: true })

    child.on('error', (error) => {
      settle(
        new NarrationError(
          'WORKER_FAILED',
          `Cannot start Edge TTS worker with ${JSON.stringify(python)}: ${error.message}. Install requirements.txt (edge-tts) in the render Python environment.`,
          { python, workerScript, error: error.message }
        )
      )
    })

    child.on('exit', () => {
      exited = true
    })

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk])
      if (stdout.length > MAX_STDOUT_BYTES) {
        settle(
          new NarrationError('WORKER_FAILED', 'Edge TTS worker produced an oversized result', {
            bytes: stdout.length
          })
        )
        killChild()
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > MAX_STDERR_CHARS) {
        stderr = stderr.slice(-MAX_STDERR_CHARS)
      }
    })

    child.stdin.on('error', (error) => {
      // A worker that died before reading stdin will also emit 'close'; keep the
      // pipe error from crashing the process.
      logger.debug('Edge TTS worker stdin closed early', { error: String(error) })
    })

    child.on('close', (code, signal) => {
      if (aborted) {
        settle(createCancellationError(options.signal))
        return
      }
      if (settled) return

      const text = stdout.toString('utf8').trim()
      if (!text) {
        settle(
          new NarrationError(
            'WORKER_FAILED',
            `Edge TTS worker exited ${code ?? signal ?? 'unknown'} without JSON output. ${tail(stderr) || 'No stderr.'}`,
            { exitCode: code, signal, stderr: tail(stderr) }
          )
        )
        return
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch (error) {
        settle(
          new NarrationError(
            'WORKER_FAILED',
            `Edge TTS worker returned invalid JSON (${error instanceof Error ? error.message : String(error)}). ${tail(stderr)}`,
            { exitCode: code, signal, stdout: tail(text), stderr: tail(stderr) }
          )
        )
        return
      }

      try {
        const results = validateWorkerResult(payload, { ...options, outputDirectory, env })
        if (code !== 0) {
          settle(
            new NarrationError(
              'WORKER_FAILED',
              `Edge TTS worker reported success but exited ${code}. ${tail(stderr)}`,
              { exitCode: code, signal }
            )
          )
          return
        }
        if (stderr.trim()) {
          logger.debug('Edge TTS worker diagnostics', { stderr: tail(stderr) })
        }
        settle(undefined, results)
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)))
      }
    })

    try {
      child.stdin.end(JSON.stringify(input), 'utf8')
    } catch (error) {
      settle(
        new NarrationError('WORKER_FAILED', `Cannot send input to Edge TTS worker: ${String(error)}`)
      )
      killChild()
    }
  })
}
