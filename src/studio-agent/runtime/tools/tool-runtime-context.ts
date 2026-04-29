import type {
  StudioSession,
  StudioPartStore,
  StudioMessageStore,
  StudioSessionStore,
  StudioToolChoice,
  StudioToolContext
} from '../../domain/types'
import type { CustomApiConfig } from '../../../types'
import type { ActiveSkillStore } from '../../skills/state/skill-state-store'
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
  partStore?: StudioPartStore
  messageStore?: StudioMessageStore
  sessionStore?: StudioSessionStore
  activeSkillStore?: ActiveSkillStore
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
