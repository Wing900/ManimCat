import type {
  StudioPermissionDecision,
  StudioPermissionRequest,
  StudioSession,
  StudioSessionStore,
  StudioToolContext
} from '../domain/types'
import type { CustomApiConfig } from '../../types'

export interface StudioSubagentRunRequest {
  projectId: string
  parentSession: StudioSession
  childSession: StudioSession
  description: string
  inputText: string
  subagentType: 'reviewer' | 'designer'
  skillName?: string
  files?: string[]
  customApiConfig?: CustomApiConfig
}

export interface StudioSubagentRunResult {
  text: string
}

export interface StudioResolvedSkill {
  name: string
  description: string
  directory: string
  entryFile: string
  content: string
  manifestPath?: string
  manifest?: Record<string, unknown>
  preferredAgent?: 'builder' | 'reviewer' | 'designer'
  allowedTools?: string[]
  files: string[]
}

export interface StudioToolPermissionRequest {
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always?: string[]
}

export interface StudioRuntimeBackedToolContext extends StudioToolContext {
  sessionStore?: StudioSessionStore
  ask?: (request: StudioToolPermissionRequest) => Promise<StudioPermissionDecision>
  runSubagent?: (input: StudioSubagentRunRequest) => Promise<StudioSubagentRunResult>
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
}

export function toPermissionRequest(
  request: StudioToolPermissionRequest,
  base: Pick<StudioPermissionRequest, 'id' | 'sessionID'>,
  tool: NonNullable<StudioPermissionRequest['tool']>
): StudioPermissionRequest {
  return {
    id: base.id,
    sessionID: base.sessionID,
    permission: request.permission,
    patterns: request.patterns,
    metadata: request.metadata,
    always: request.always ?? request.patterns,
    tool
  }
}
