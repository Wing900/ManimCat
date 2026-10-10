import { lstat, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { STUDIO_SCENE_DIRECTORY } from './studio-scene-service'
import { STUDIO_WORKSPACE_ACTIVITY_FILE } from '../infrastructure/workspace/studio-workspace-cleanup'

/**
 * Writes a Session's Scene sources into its workspace before a Run starts.
 *
 * The browser owns the code, so every Run carries the whole Session's sources and the server
 * materializes them fresh. The session runner's execution-scope loader then validates exactly these
 * files, which is why this must finish first: it is the step that makes the workspace match what the
 * agent is about to be asked about.
 *
 * Authorization here is structural rather than path-based: a Scene id must be a Python module stem,
 * the directory is fixed, and a symlinked `scenes/` or `scenes/<id>.py` is refused outright. Nothing
 * the caller sends can name a location.
 */

/** Python module stems only — the same shape the Scene service mints and validates. */
const SCENE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Ceilings that keep one hostile request from filling the disk through this path. */
export const MAX_STUDIO_SCENE_SOURCES = 200
export const MAX_STUDIO_SCENE_SOURCE_LENGTH = 512 * 1024

export type StudioSceneSourceRejectionReason =
  | 'invalid_scene_id'
  | 'too_many_sources'
  | 'source_too_large'
  | 'unsafe_scene_directory'

export class StudioSceneSourceRejectedError extends Error {
  constructor(
    readonly reason: StudioSceneSourceRejectionReason,
    readonly sceneId?: string
  ) {
    super(`Studio Scene source rejected: ${reason}`)
    this.name = 'StudioSceneSourceRejectedError'
  }
}

export async function materializeStudioSceneSources(input: {
  rootDirectory: string
  sceneSources: Record<string, string>
}): Promise<{ sceneIds: string[] }> {
  const sceneIds = Object.keys(input.sceneSources)
  if (sceneIds.length > MAX_STUDIO_SCENE_SOURCES) {
    throw new StudioSceneSourceRejectedError('too_many_sources')
  }
  if (typeof input.rootDirectory !== 'string' || !input.rootDirectory.trim()) {
    throw new StudioSceneSourceRejectedError('unsafe_scene_directory')
  }

  const scenesDirectory = path.join(input.rootDirectory, STUDIO_SCENE_DIRECTORY)
  // A pre-existing non-directory is not an error here: the check below turns it into one refusal
  // with a stable reason, instead of an fs error the caller would have to interpret.
  await mkdir(scenesDirectory, { recursive: true }).catch(() => undefined)

  // A symlinked `scenes/` would let these writes land outside the Session workspace.
  const directory = await lstat(scenesDirectory)
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new StudioSceneSourceRejectedError('unsafe_scene_directory')
  }

  for (const sceneId of sceneIds) {
    if (!SCENE_ID_PATTERN.test(sceneId)) {
      throw new StudioSceneSourceRejectedError('invalid_scene_id', sceneId)
    }

    const source = input.sceneSources[sceneId]
    if (typeof source !== 'string' || source.length > MAX_STUDIO_SCENE_SOURCE_LENGTH) {
      throw new StudioSceneSourceRejectedError('source_too_large', sceneId)
    }

    const targetPath = path.join(scenesDirectory, `${sceneId}.py`)
    const existing = await lstat(targetPath).catch(() => null)
    if (existing?.isSymbolicLink()) {
      throw new StudioSceneSourceRejectedError('unsafe_scene_directory', sceneId)
    }

    await writeFile(targetPath, source, 'utf8')
  }

  // The sweep reads this marker instead of directory mtimes: a background write must not look like
  // user activity, and a materialization must.
  await writeFile(
    path.join(input.rootDirectory, STUDIO_WORKSPACE_ACTIVITY_FILE),
    new Date().toISOString(),
    'utf8'
  )

  return { sceneIds }
}
