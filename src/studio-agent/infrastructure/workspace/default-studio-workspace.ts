import fs from 'node:fs'
import { getStudioWorkspaceRootDirectory } from './studio-workspace-cleanup'

/**
 * Root of the Studio scratch workspaces: the system temp directory by default, never the project.
 *
 * The browser owns the durable copy of every Session, so a workspace here only has to survive a Run
 * and the renders in flight. Losing one is not data loss: the next Run materializes the sources again
 * from the request. Override with `STUDIO_WORKSPACE_ROOT` when a specific volume is wanted.
 */
export function getDefaultStudioWorkspacePath(): string {
  return getStudioWorkspaceRootDirectory()
}

export function ensureDefaultStudioWorkspaceExists(): string {
  const directory = getDefaultStudioWorkspacePath()
  fs.mkdirSync(directory, { recursive: true })
  return directory
}
