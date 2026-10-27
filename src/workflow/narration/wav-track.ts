/**
 * Exact PCM-WAV handling for Edge TTS segments.
 *
 * Segment durations come from decoded sample frames, not from file names or MP3
 * container estimates. All segments are normalized to mono 16-bit PCM at one
 * sample rate by the worker, so concatenation is a byte copy under a fresh header.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { NarrationError, createCancellationError } from './narration-error'

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  blockAlign: number
  byteRate: number
  dataOffset: number
  dataSize: number
  frames: number
  duration: number
  fileSize: number
}

export interface ConcatInput {
  path: string
  info: WavInfo
}

export interface ConcatSegmentTiming {
  path: string
  start: number
  duration: number
  frames: number
}

export interface ConcatResult {
  path: string
  sampleRate: number
  channels: number
  totalFrames: number
  duration: number
  segments: ConcatSegmentTiming[]
}

const READ_CHUNK_BYTES = 1024 * 1024
const MAX_WAV_DATA_BYTES = 0xffffffff

async function readExactly(
  handle: fsp.FileHandle,
  length: number,
  position: number
): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const result = await handle.read(buffer, read, length - read, position + read)
    if (result.bytesRead <= 0) break
    read += result.bytesRead
  }
  return buffer.subarray(0, read)
}

/** Parse RIFF/WAVE chunks and require canonical 16-bit PCM. */
export async function readWavInfo(filePath: string): Promise<WavInfo> {
  let handle: fsp.FileHandle
  try {
    handle = await fsp.open(filePath, 'r')
  } catch (error) {
    throw new NarrationError('WAV_INVALID', `Cannot open WAV file ${filePath}: ${String(error)}`, {
      filePath
    })
  }

  try {
    const stat = await handle.stat()
    const header = await readExactly(handle, 12, 0)
    if (
      header.length !== 12 ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      throw new NarrationError('WAV_INVALID', `Not a RIFF/WAVE file: ${filePath}`, { filePath })
    }

    let format:
      | { audioFormat: number; channels: number; sampleRate: number; byteRate: number; blockAlign: number; bitsPerSample: number }
      | undefined
    let dataOffset = -1
    let dataSize = -1
    let position = 12

    while (position + 8 <= stat.size) {
      const chunkHeader = await readExactly(handle, 8, position)
      if (chunkHeader.length < 8) break
      const chunkId = chunkHeader.toString('ascii', 0, 4)
      const chunkSize = chunkHeader.readUInt32LE(4)
      const payloadOffset = position + 8
      if (payloadOffset + chunkSize > stat.size) {
        throw new NarrationError('WAV_INVALID', `Truncated ${chunkId} chunk: ${filePath}`, {
          filePath,
          chunkId,
          chunkSize
        })
      }
      if (chunkId === 'fmt ') {
        const payload = await readExactly(handle, Math.min(chunkSize, 64), payloadOffset)
        if (payload.length < 16) {
          throw new NarrationError('WAV_INVALID', `Short fmt chunk: ${filePath}`, { filePath })
        }
        format = {
          audioFormat: payload.readUInt16LE(0),
          channels: payload.readUInt16LE(2),
          sampleRate: payload.readUInt32LE(4),
          byteRate: payload.readUInt32LE(8),
          blockAlign: payload.readUInt16LE(12),
          bitsPerSample: payload.readUInt16LE(14)
        }
      } else if (chunkId === 'data') {
        dataOffset = payloadOffset
        dataSize = chunkSize
        break
      }
      position = payloadOffset + chunkSize + (chunkSize % 2)
    }

    if (!format || dataOffset < 0 || dataSize <= 0) {
      throw new NarrationError('WAV_INVALID', `Missing fmt or data chunk: ${filePath}`, { filePath })
    }
    if (format.audioFormat !== 1) {
      throw new NarrationError(
        'WAV_INVALID',
        `Expected PCM format 1, got ${format.audioFormat}: ${filePath}`,
        { filePath, format }
      )
    }
    if (format.bitsPerSample !== 16) {
      throw new NarrationError(
        'WAV_INVALID',
        `Expected 16-bit PCM, got ${format.bitsPerSample}: ${filePath}`,
        { filePath, format }
      )
    }
    if (format.channels <= 0 || format.sampleRate <= 0 || format.blockAlign <= 0) {
      throw new NarrationError('WAV_INVALID', `Invalid fmt values: ${filePath}`, { filePath, format })
    }
    if (dataSize % format.blockAlign !== 0) {
      throw new NarrationError('WAV_INVALID', `Partial sample frame in data chunk: ${filePath}`, {
        filePath,
        dataSize,
        blockAlign: format.blockAlign
      })
    }

    const frames = dataSize / format.blockAlign
    return {
      sampleRate: format.sampleRate,
      channels: format.channels,
      bitsPerSample: format.bitsPerSample,
      blockAlign: format.blockAlign,
      byteRate: format.byteRate,
      dataOffset,
      dataSize,
      frames,
      duration: frames / format.sampleRate,
      fileSize: stat.size
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export async function copyFileAtomic(source: string, target: string): Promise<void> {
  const temp = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  await fsp.mkdir(path.dirname(target), { recursive: true })
  try {
    await fsp.copyFile(source, temp)
    await replaceFileAtomic(temp, target)
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function replaceFileAtomic(temp: string, target: string): Promise<void> {
  try {
    await fsp.rename(temp, target)
  } catch {
    // Windows rename-over-existing can fail depending on sharing mode.
    await fsp.rm(target, { force: true })
    await fsp.rename(temp, target)
  }
}

function buildWavHeader(sampleRate: number, channels: number, dataSize: number): Buffer {
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bytesPerSample * 8, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)
  return header
}

/**
 * Concatenate the decoded data chunks of already-validated WAV files in plan order.
 *
 * Returns frame-exact starts and durations so every cue is offset against real
 * samples. The output is written to a temporary file and only then renamed into
 * place, so a cancelled run cannot leave a half-length narration track behind.
 */
export async function concatWavFiles(
  inputs: readonly ConcatInput[],
  outputPath: string,
  expected: { sampleRate: number; channels: number },
  signal?: AbortSignal
): Promise<ConcatResult> {
  if (inputs.length === 0) {
    throw new NarrationError('WAV_INVALID', 'Cannot concatenate zero narration segments')
  }

  for (const input of inputs) {
    if (!input.info) {
      throw new NarrationError('WAV_INVALID', `Missing WAV metadata for ${input.path}`)
    }
    if (
      input.info.sampleRate !== expected.sampleRate ||
      input.info.channels !== expected.channels ||
      input.info.bitsPerSample !== 16
    ) {
      throw new NarrationError(
        'WAV_INVALID',
        `Segment format mismatch: ${input.path} is ${input.info.sampleRate}Hz/${input.info.channels}ch/${input.info.bitsPerSample}bit`,
        { path: input.path, expected, actual: input.info }
      )
    }
    if (input.info.blockAlign !== expected.channels * 2) {
      throw new NarrationError('WAV_INVALID', `Unexpected block alignment: ${input.path}`, {
        path: input.path,
        blockAlign: input.info.blockAlign
      })
    }
  }

  if (signal?.aborted) {
    throw createCancellationError(signal)
  }

  const blockAlign = expected.channels * 2
  const totalFrames = inputs.reduce((total, input) => total + input.info.frames, 0)
  const dataSize = totalFrames * blockAlign
  if (!Number.isSafeInteger(dataSize) || dataSize <= 0 || dataSize > MAX_WAV_DATA_BYTES - 36) {
    throw new NarrationError('WAV_INVALID', `Narration track is too large: ${dataSize} bytes`, {
      dataSize
    })
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true })
  const tempPath = `${outputPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  const outputHandle = await fsp.open(tempPath, 'w')
  const segments: ConcatSegmentTiming[] = []
  let frameCursor = 0

  try {
    const header = buildWavHeader(expected.sampleRate, expected.channels, dataSize)
    await outputHandle.write(header, 0, header.length, 0)

    let outputPosition = header.length
    for (const input of inputs) {
      if (signal?.aborted) {
        throw createCancellationError(signal)
      }
      const start = frameCursor / expected.sampleRate
      const duration = input.info.frames / expected.sampleRate
      segments.push({ path: input.path, start, duration, frames: input.info.frames })
      frameCursor += input.info.frames

      const sourceHandle = await fsp.open(input.path, 'r')
      try {
        let sourcePosition = input.info.dataOffset
        let remaining = input.info.dataSize
        const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, Math.max(blockAlign, remaining)))
        while (remaining > 0) {
          if (signal?.aborted) {
            throw createCancellationError(signal)
          }
          const toRead = Math.min(buffer.length, remaining)
          const { bytesRead } = await sourceHandle.read(buffer, 0, toRead, sourcePosition)
          if (bytesRead <= 0) {
            throw new NarrationError('WAV_INVALID', `Unexpected EOF in ${input.path}`, {
              path: input.path,
              remaining
            })
          }
          let written = 0
          while (written < bytesRead) {
            const result = await outputHandle.write(
              buffer,
              written,
              bytesRead - written,
              outputPosition + written
            )
            if (result.bytesWritten <= 0) {
              throw new NarrationError('WAV_INVALID', `Cannot write narration track ${outputPath}`)
            }
            written += result.bytesWritten
          }
          outputPosition += bytesRead
          sourcePosition += bytesRead
          remaining -= bytesRead
        }
      } finally {
        await sourceHandle.close().catch(() => undefined)
      }
    }

    const expectedSize = header.length + dataSize
    const outputStat = await outputHandle.stat()
    if (outputStat.size !== expectedSize) {
      throw new NarrationError(
        'WAV_INVALID',
        `Narration track size ${outputStat.size} != expected ${expectedSize}`,
        { outputPath, actual: outputStat.size, expectedSize }
      )
    }
  } catch (error) {
    await outputHandle.close().catch(() => undefined)
    await fsp.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }

  await outputHandle.close()
  await replaceFileAtomic(tempPath, outputPath)

  const duration = totalFrames / expected.sampleRate
  const verified = await readWavInfo(outputPath)
  if (
    verified.frames !== totalFrames ||
    verified.sampleRate !== expected.sampleRate ||
    verified.channels !== expected.channels
  ) {
    await fsp.rm(outputPath, { force: true }).catch(() => undefined)
    throw new NarrationError('WAV_INVALID', `Concatenated track failed verification: ${outputPath}`, {
      outputPath,
      expected: { totalFrames, ...expected },
      actual: verified
    })
  }

  return {
    path: outputPath,
    sampleRate: expected.sampleRate,
    channels: expected.channels,
    totalFrames,
    duration,
    segments
  }
}

