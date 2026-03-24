import type { StudioPermissionMode, StudioSession } from '../protocol/studio-agent-types'

export interface StudioPermissionModeDescriptor {
  mode: StudioPermissionMode
  command: '/safe' | '/auto' | '/full'
}

const COMMAND_TO_MODE: Record<string, StudioPermissionMode> = {
  '/safe': 'safe',
  '/auto': 'auto',
  '/full': 'full',
}

export function parseStudioPermissionModeCommand(input: string): StudioPermissionModeDescriptor | null {
  const normalized = input.trim().toLowerCase()
  const mode = COMMAND_TO_MODE[normalized]
  return mode ? { mode, command: normalized as '/safe' | '/auto' | '/full' } : null
}

export function getStudioPermissionMode(session: StudioSession | null | undefined): StudioPermissionMode {
  const mode = session?.metadata?.permissionMode
  return mode === 'safe' || mode === 'auto' || mode === 'full' ? mode : 'auto'
}
