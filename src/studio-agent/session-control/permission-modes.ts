import type {
  StudioPermissionLevel,
  StudioPermissionRule,
  StudioSession,
} from '../domain/types'
import { createStudioSessionMetadata } from '../runtime/session-agent-config'

export type StudioPermissionMode = 'safe' | 'auto' | 'full'

export interface StudioPermissionModeConfig {
  mode: StudioPermissionMode
  permissionLevel: StudioPermissionLevel
  permissionRules: StudioPermissionRule[]
  metadata: Record<string, unknown> | undefined
}

export function resolveStudioPermissionMode(mode: StudioPermissionMode, session: StudioSession): StudioPermissionModeConfig {
  const permissionLevel = mode === 'safe' ? 'L2' : mode === 'auto' ? 'L3' : 'L4'

  return {
    mode,
    permissionLevel,
    permissionRules: buildRulesForMode(mode),
    metadata: createStudioSessionMetadata({
      existing: session.metadata,
      permissionMode: mode,
    }),
  }
}

export function getStudioPermissionMode(session: StudioSession): StudioPermissionMode {
  const metadata = session.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return 'auto'
  }

  const candidate = (metadata as Record<string, unknown>).permissionMode
  return candidate === 'safe' || candidate === 'auto' || candidate === 'full' ? candidate : 'auto'
}

function buildRulesForMode(mode: StudioPermissionMode): StudioPermissionRule[] {
  const baseReadRules: StudioPermissionRule[] = [
    { permission: 'read', pattern: '*', action: 'allow' },
    { permission: 'glob', pattern: '*', action: 'allow' },
    { permission: 'grep', pattern: '*', action: 'allow' },
    { permission: 'ls', pattern: '*', action: 'allow' },
    { permission: 'question', pattern: '*', action: 'allow' },
  ]

  if (mode === 'safe') {
    return [
      ...baseReadRules,
      { permission: 'write', pattern: '*', action: 'deny' },
      { permission: 'edit', pattern: '*', action: 'deny' },
      { permission: 'apply_patch', pattern: '*', action: 'deny' },
      { permission: 'render', pattern: '*', action: 'deny' },
      { permission: 'task', pattern: '*', action: 'deny' },
      { permission: 'skill', pattern: '*', action: 'deny' },
      { permission: 'static-check', pattern: '*', action: 'deny' },
      { permission: 'ai-review', pattern: '*', action: 'deny' },
    ]
  }

  if (mode === 'auto') {
    return [
      ...baseReadRules,
      { permission: 'write', pattern: '*', action: 'allow' },
      { permission: 'edit', pattern: '*', action: 'allow' },
      { permission: 'apply_patch', pattern: '*', action: 'allow' },
      { permission: 'render', pattern: '*', action: 'allow' },
      { permission: 'task', pattern: '*', action: 'allow' },
      { permission: 'skill', pattern: '*', action: 'allow' },
      { permission: 'static-check', pattern: '*', action: 'allow' },
      { permission: 'ai-review', pattern: '*', action: 'allow' },
      { permission: 'delete', pattern: '*', action: 'deny' },
    ]
  }

  return [{ permission: '*', pattern: '*', action: 'allow' }]
}
