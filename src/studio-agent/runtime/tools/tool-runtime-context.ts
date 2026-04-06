import type {
  StudioPermissionDecision,
  StudioPermissionRequest,
  StudioSession,
  StudioSessionStore,
  StudioToolChoice,
  StudioToolContext
} from '../../domain/types'
import type { CustomApiConfig } from '../../../types'
import type {
  StudioResolvedSkill,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary
} from '../../skills/schema/skill-types'

export type {
  StudioResolvedSkill,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary
} from '../../skills/schema/skill-types'

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
  toolChoice?: StudioToolChoice
}

export interface StudioSubagentRunResult {
  text: string
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
  listSkills?: (session: StudioSession) => Promise<StudioSkillDiscoveryEntry[]>
  listSkillSummaries?: (session: StudioSession) => Promise<StudioSkillUsageSummary[]>
  recordSkillUsage?: (input: {
    session: StudioSession
    skillName: string
    reason?: string
    takeaway?: string
    stillRelevant?: boolean
  }) => Promise<void>
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
