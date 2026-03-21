import path from 'node:path'
import type { StudioSession } from '../domain/types'
import type { StudioWorkspaceProvider } from './studio-workspace-provider'

export function createLocalStudioWorkspaceProvider(): StudioWorkspaceProvider {
  return {
    kind: 'local',
    requiresDirectoryAccess: true,
    normalizeDirectory(directory: string, input?: { session?: StudioSession | null }): string {
      const baseDir = input?.session?.directory?.trim() || process.cwd()
      const nextDir = directory.trim()
      if (!nextDir) {
        return baseDir
      }

      return path.isAbsolute(nextDir)
        ? path.normalize(nextDir)
        : path.resolve(baseDir, nextDir)
    },
  }
}
