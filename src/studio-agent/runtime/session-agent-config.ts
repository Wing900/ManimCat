import type { StudioSession, StudioToolChoice } from '../domain/types'

export interface StudioSessionAgentConfig {
  toolChoice?: StudioToolChoice
}

export function getStudioSessionAgentConfig(session: StudioSession): StudioSessionAgentConfig {
  const metadata = session.metadata
  if (!metadata || typeof metadata !== 'object') {
    return {}
  }

  const candidate = (metadata as Record<string, unknown>).agentConfig
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {}
  }

  const toolChoice = normalizeToolChoice((candidate as Record<string, unknown>).toolChoice)
  return toolChoice ? { toolChoice } : {}
}

export function resolveStudioToolChoice(input: {
  session: StudioSession
  override?: StudioToolChoice
}): StudioToolChoice | undefined {
  return normalizeToolChoice(input.override) ?? getStudioSessionAgentConfig(input.session).toolChoice
}

export function inheritStudioSessionMetadata(session: StudioSession): Record<string, unknown> | undefined {
  if (!session.metadata || typeof session.metadata !== 'object') {
    return undefined
  }

  return { ...session.metadata }
}

export function createStudioSessionMetadata(input: {
  existing?: Record<string, unknown>
  agentConfig?: StudioSessionAgentConfig
  permissionMode?: 'safe' | 'auto' | 'full'
}): Record<string, unknown> | undefined {
  const toolChoice = normalizeToolChoice(input.agentConfig?.toolChoice)
  const permissionMode = normalizePermissionMode(input.permissionMode)
  const base = input.existing ? { ...input.existing } : {}
  const existingAgentConfig = base.agentConfig && typeof base.agentConfig === 'object' && !Array.isArray(base.agentConfig)
    ? { ...(base.agentConfig as Record<string, unknown>) }
    : {}

  if (!toolChoice) {
    if (!Object.keys(existingAgentConfig).length) {
      delete base.agentConfig
    } else {
      base.agentConfig = existingAgentConfig
    }
  } else {
    base.agentConfig = {
      ...existingAgentConfig,
      toolChoice,
    }
  }

  if (permissionMode) {
    base.permissionMode = permissionMode
  } else {
    delete base.permissionMode
  }

  return Object.keys(base).length ? base : undefined
}

function normalizeToolChoice(value: unknown): StudioToolChoice | undefined {
  return value === 'auto' || value === 'required' || value === 'none' ? value : undefined
}

function normalizePermissionMode(value: unknown): 'safe' | 'auto' | 'full' | undefined {
  return value === 'safe' || value === 'auto' || value === 'full' ? value : undefined
}
