import type { StudioSession } from '../../domain/types'

export type StudioSkillScope = 'common' | 'plot' | 'manim'

export interface StudioSkillManifest {
  name: string
  description: string
  scope?: StudioSkillScope
  tags?: string[]
  version?: string | number
}

export interface StudioSkillDiscoveryEntry extends StudioSkillManifest {
  directory: string
  entryFile: string
  source: 'catalog' | 'workspace'
}

export interface StudioResolvedSkill extends StudioSkillDiscoveryEntry {
  content: string
  body: string
  files: string[]
}

export interface StudioSkillUsageSummary {
  sessionId: string
  skillName: string
  reason?: string
  takeaway?: string
  stillRelevant?: boolean
  timestamp: string
}

export interface StudioSkillSource {
  list(session: StudioSession): Promise<StudioSkillDiscoveryEntry[]>
}
