/**
 * Copy server-owned narration assets into the private read-only sandbox input.
 *
 * The staged manifest contains sandbox paths only. Parent/workspace paths are
 * never written into the manifest or exposed to the renderer.
 */

import fs from 'node:fs'
import path from 'node:path'
import { assertRegularNonSymlinkFile, copyVerifiedRegularFile } from './sandbox-artifacts'

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024
const SAFE_AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac'])

export interface StagedNarration {
  manifestPath: string
  syncReportPath?: string
}

interface StagedManifestSegment {
  id: unknown
  start: unknown
  duration: unknown
  audioPath: string
  cues: unknown
}

function readManifest(manifestPath: string): Record<string, unknown> {
  const stat = assertRegularNonSymlinkFile(manifestPath, 'Narration manifest')
  if (stat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`Narration manifest is too large: ${manifestPath}`)
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Narration manifest must be a JSON object')
  }
  const manifest = parsed as Record<string, unknown>
  if (manifest.version !== 1) {
    throw new Error(`Unsupported narration manifest version: ${String(manifest.version)}`)
  }
  return manifest
}

function resolveSourcePath(value: string, manifestDirectory: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(manifestDirectory, value)
}

/**
 * Stage narration.wav + all segment WAVs and rewrite the manifest to /input
 * paths. Every source must be a regular non-symlink file.
 */
export function stageNarrationForSandbox(options: {
  inputDirectory: string
  manifestPath: string
  syncReportPath?: string
}): StagedNarration {
  const sourceManifestPath = path.resolve(options.manifestPath)
  const manifest = readManifest(sourceManifestPath)
  const sourceDirectory = path.dirname(sourceManifestPath)
  const narrationDirectory = path.join(options.inputDirectory, 'narration')
  fs.mkdirSync(narrationDirectory, { recursive: true })

  const copied = new Map<string, string>()
  let audioIndex = 0

  const stageAudio = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${label} must be a non-empty path`)
    }
    const source = resolveSourcePath(value, sourceDirectory)
    assertRegularNonSymlinkFile(source, label)
    const realSource = fs.realpathSync(source)
    const existing = copied.get(realSource)
    if (existing) return existing

    const extension = path.extname(source).toLowerCase()
    const safeExtension = SAFE_AUDIO_EXTENSIONS.has(extension) ? extension : '.audio'
    const target = path.join(narrationDirectory, `audio-${audioIndex++}${safeExtension}`)
    copyVerifiedRegularFile(source, target)

    const sandboxPath = `/input/narration/${path.basename(target)}`
    copied.set(realSource, sandboxPath)
    return sandboxPath
  }

  const rawSegments = manifest.segments
  if (!Array.isArray(rawSegments)) {
    throw new Error('Narration manifest segments must be an array')
  }

  const segments: StagedManifestSegment[] = rawSegments.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Narration manifest segments[${index}] must be an object`)
    }
    const segment = raw as Record<string, unknown>
    const audioPath = stageAudio(segment.audioPath, `segments[${index}].audioPath`)
    return {
      id: segment.id,
      start: segment.start,
      duration: segment.duration,
      audioPath,
      cues: segment.cues,
    }
  })

  const staged = {
    version: 1,
    audioPath: stageAudio(manifest.audioPath, 'audioPath'),
    duration: manifest.duration,
    segments,
    cues: manifest.cues,
  }

  const stagedManifestPath = path.join(narrationDirectory, 'manifest.json')
  const temporary = `${stagedManifestPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(staged, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, stagedManifestPath)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }

  return {
    manifestPath: '/input/narration/manifest.json',
    ...(options.syncReportPath ? { syncReportPath: '/output/sync-report.json' } : {}),
  }
}
