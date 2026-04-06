import type { StudioSession } from '../../domain/types'
import { createStudioSkillRegistry, type StudioSkillRegistry } from '../registry/skill-registry'
import { createStudioSkillLoader } from '../resolver/skill-loader'
import type {
  StudioResolvedSkill,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary
} from '../schema/skill-types'
import {
  createInMemoryStudioSkillStateStore,
  type StudioSkillStateStore
} from '../state/skill-state-store'

export interface StudioSkillRuntime {
  listDiscovery(session: StudioSession): Promise<StudioSkillDiscoveryEntry[]>
  resolve(name: string, session: StudioSession): Promise<StudioResolvedSkill>
  listSummaries(session: StudioSession): Promise<StudioSkillUsageSummary[]>
  recordUsage(input: {
    session: StudioSession
    skillName: string
    reason?: string
    takeaway?: string
    stillRelevant?: boolean
  }): Promise<void>
}

export function createStudioSkillRuntime(input?: {
  registry?: StudioSkillRegistry
  stateStore?: StudioSkillStateStore
  maxFiles?: number
}): StudioSkillRuntime {
  const registry = input?.registry ?? createStudioSkillRegistry()
  const loader = createStudioSkillLoader({
    registry,
    maxFiles: input?.maxFiles
  })
  const stateStore = input?.stateStore ?? createInMemoryStudioSkillStateStore()

  return {
    listDiscovery(session) {
      return registry.list(session)
    },
    resolve(name, session) {
      return loader.resolve(name, session)
    },
    listSummaries(session) {
      return stateStore.list(session)
    },
    recordUsage(value) {
      return stateStore.record(value)
    }
  }
}
