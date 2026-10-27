import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Activity metadata for Session workspaces lives outside the workspace itself.
 *
 * A marker inside the workspace is visible to the model's file tools, and it pollutes the directory
 * the agent is asked to reason about. The marker therefore lives in a runtime-owned temp directory,
 * keyed by a hash of the resolved workspace path. Its mtime is the authoritative activity timestamp.
 */

/**
 * Legacy marker written by older Runs. It is read once for migration and never written again; the
 * export stays for fixtures that still construct the old layout.
 */
export const STUDIO_WORKSPACE_ACTIVITY_FILE = '.last-active'

function getStudioWorkspaceActivityRootDirectory(): string {
  return path.join(os.tmpdir(), 'manimcat-studio-runtime', 'workspace-activity')
}

function getActivityMarkerPath(directory: string): string {
  const digest = createHash('sha256').update(path.resolve(directory)).digest('hex')
  return path.join(getStudioWorkspaceActivityRootDirectory(), `${digest}.last-active`)
}

function getLegacyMarkerPath(directory: string): string {
  return path.join(directory, STUDIO_WORKSPACE_ACTIVITY_FILE)
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

async function statOrNull(target: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(target)
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    throw error
  }
}

async function writeActivityMarker(directory: string, mtime: Date): Promise<void> {
  const marker = getActivityMarkerPath(directory)
  await fsp.mkdir(path.dirname(marker), { recursive: true })
  await fsp.writeFile(marker, mtime.toISOString(), 'utf8')
  await fsp.utimes(marker, mtime, mtime)
}

async function removeLegacyMarker(directory: string): Promise<void> {
  try {
    await fsp.unlink(getLegacyMarkerPath(directory))
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
  }
}

/** Marks a workspace as active now, and removes any legacy in-workspace marker. */
export async function recordStudioWorkspaceActivity(directory: string): Promise<void> {
  await writeActivityMarker(directory, new Date())
  await removeLegacyMarker(directory)
}

/**
 * Last activity of one Session workspace, in epoch milliseconds.
 *
 * The external marker wins. A legacy in-workspace marker is migrated once: its mtime is captured
 * before unlinking (unlink changes the directory mtime), written to the external marker, and the old
 * file is removed. Without either marker the directory mtime remains the fallback.
 */
export async function readStudioWorkspaceLastActivity(directory: string): Promise<number> {
  const externalStats = await statOrNull(getActivityMarkerPath(directory))
  if (externalStats) {
    await removeLegacyMarker(directory)
    return externalStats.mtimeMs
  }

  const legacyStats = await statOrNull(getLegacyMarkerPath(directory))
  if (legacyStats) {
    await writeActivityMarker(directory, legacyStats.mtime)
    await removeLegacyMarker(directory)
    return legacyStats.mtimeMs
  }

  const directoryStats = await statOrNull(directory)
  return directoryStats ? directoryStats.mtimeMs : 0
}

/** Removes the external marker for one workspace. The legacy marker disappears with the workspace. */
export async function removeStudioWorkspaceActivity(directory: string): Promise<void> {
  try {
    await fsp.unlink(getActivityMarkerPath(directory))
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
  }
}
