import type { StudioPermissionMode } from '../protocol/studio-agent-types'
import { parseStudioPermissionModeCommand } from './permission-modes'

export type StudioSlashCommand = {
  type: 'permission-mode'
  raw: '/safe' | '/auto' | '/full'
  mode: StudioPermissionMode
}

export function parseStudioSlashCommand(input: string): StudioSlashCommand | null {
  const permissionMode = parseStudioPermissionModeCommand(input)
  if (permissionMode) {
    return {
      type: 'permission-mode',
      raw: permissionMode.command,
      mode: permissionMode.mode,
    }
  }

  return null
}
