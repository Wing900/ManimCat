import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '../../../shared/logging/logger'

const logger = createLogger('StudioWorkspaceCleanup')

/**
 * A Session workspace is scratch space: it holds the Scene sources of one Run plus whatever the
 * renderer wrote, and the browser owns the durable copy. It is abandoned after a few hours without a
 * Run, and losing one is not data loss — the next Run materializes the sources again from the request.
 */

/** Hours without a Run before a Session workspace is removed. Matches the product decision (5h). */
export const DEFAULT_STUDIO_WORKSPACE_TTL_HOURS = 5
export const DEFAULT_STUDIO_WORKSPACE_CLEANUP_INTERVAL_MINUTES = 30

/**
 * Written by every Run that materializes sources, so "used recently" does not depend on directory
 * mtimes, which a background write can move for reasons unrelated to user activity.
 */
export const STUDIO_WORKSPACE_ACTIVITY_FILE = '.last-active'

export function readStudioWorkspaceTtlHours(): number {
  return readPositiveNumber(process.env.STUDIO_WORKSPACE_TTL_HOURS, DEFAULT_STUDIO_WORKSPACE_TTL_HOURS)
}

export function readStudioWorkspaceCleanupIntervalMinutes(): number {
  return readPositiveNumber(
    process.env.STUDIO_WORKSPACE_CLEANUP_INTERVAL_MINUTES,
    DEFAULT_STUDIO_WORKSPACE_CLEANUP_INTERVAL_MINUTES
  )
}

function readPositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Last activity of one Session workspace, in epoch milliseconds.
 *
 * The activity marker wins when it exists; its absence falls back to the directory's own mtime, which
 * keeps a workspace created before the marker existed from living forever.
 */
export async function readStudioWorkspaceLastActivity(directory: string): Promise<number> {
  const marker = path.join(directory, STUDIO_WORKSPACE_ACTIVITY_FILE)
  try {
    const stats = await fsp.stat(marker)
    return stats.mtimeMs
  } catch {
    const stats = await fsp.stat(directory).catch(() => null)
    return stats ? stats.mtimeMs : 0
  }
}

/**
 * Removes every Session workspace under `rootDirectory` that went quiet before `cutoffTime`.
 *
 * Walks the `<kind>-studio/<sessionId>` layout one level deep on purpose: the root also holds engine
 * caches that are shared and rebuildable, and those are not this cleaner's business.
 */
export async function cleanupExpiredStudioWorkspaces(input: {
  rootDirectory: string
  cutoffTime: number
}): Promise<{ removed: string[] }> {
  const removed: string[] = []
  const kinds = await fsp
    .readdir(input.rootDirectory, { withFileTypes: true })
    .catch(() => [] as fs.Dirent[])

  for (const kindEntry of kinds) {
    if (!kindEntry.isDirectory() || kindEntry.name.startsWith('.')) {
      continue
    }

    const kindDirectory = path.join(input.rootDirectory, kindEntry.name)
    const sessions = await fsp.readdir(kindDirectory, { withFileTypes: true }).catch(() => [] as fs.Dirent[])

    for (const sessionEntry of sessions) {
      if (!sessionEntry.isDirectory() || sessionEntry.name.startsWith('.')) {
        continue
      }

      const sessionDirectory = path.join(kindDirectory, sessionEntry.name)
      const lastActivity = await readStudioWorkspaceLastActivity(sessionDirectory)
      if (lastActivity === 0 || lastActivity >= input.cutoffTime) {
        continue
      }

      try {
        await fsp.rm(sessionDirectory, { recursive: true, force: true })
        removed.push(sessionDirectory)
      } catch (error) {
        // A workspace that cannot be removed is retried on the next pass; it must not stop the sweep.
        logger.warn('Studio workspace removal failed', {
          sessionDirectory: path.basename(sessionDirectory),
          reason: error instanceof Error ? error.name : 'unknown'
        })
      }
    }
  }

  return { removed }
}

/**
 * Starts the periodic sweep: one pass immediately, then every interval. The timer is `unref`ed so it
 * never holds the process open. Returns the stop function.
 */
export function startStudioWorkspaceCleanupScheduler(rootDirectory: string): () => void {
  const ttlHours = readStudioWorkspaceTtlHours()
  const intervalMinutes = readStudioWorkspaceCleanupIntervalMinutes()

  const sweep = async () => {
    const cutoffTime = Date.now() - ttlHours * 60 * 60 * 1000
    try {
      const { removed } = await cleanupExpiredStudioWorkspaces({ rootDirectory, cutoffTime })
      if (removed.length > 0) {
        logger.info('Expired Studio workspaces removed', { count: removed.length, ttlHours })
      }
    } catch (error) {
      logger.warn('Studio workspace sweep failed', {
        reason: error instanceof Error ? error.name : 'unknown'
      })
    }
  }

  void sweep()
  const timer = setInterval(() => {
    void sweep()
  }, intervalMinutes * 60 * 1000)
  timer.unref()

  return () => clearInterval(timer)
}

/** Session workspaces live under the system temp directory, not inside the project. */
export function getStudioWorkspaceRootDirectory(): string {
  const configured = process.env.STUDIO_WORKSPACE_ROOT?.trim()
  return configured ? path.resolve(configured) : path.join(os.tmpdir(), 'manimcat-studio')
}
