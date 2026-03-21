import type { StudioSession } from '../domain/types'

export interface StudioWorkspaceProvider {
  kind: 'local' | 'remote'
  requiresDirectoryAccess: boolean
  normalizeDirectory: (directory: string, input?: { session?: StudioSession | null }) => string
}
