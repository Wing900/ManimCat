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

/**
 * 5-layer skill structure defined by BUILDER_ARCHITECTURE.md
 */
export interface StudioSkillLayers {
  role: string
  workflow: string
  construction: string
  style: string
  shotHint: string
}

/**
 * A single shot example file loaded from skill shots/ directory
 */
export interface StudioShot {
  name: string
  content: string
  path: string
}

export interface StudioResolvedSkill extends StudioSkillDiscoveryEntry {
  content: string
  body: string
  files: string[]
  layers?: StudioSkillLayers
  shots?: StudioShot[]
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
