import type { StudioSession } from '../../domain/types'
import type { StudioSkillUsageSummary } from '../schema/skill-types'

export interface StudioSkillStateStore {
  list(session: StudioSession): Promise<StudioSkillUsageSummary[]>
  record(input: {
    session: StudioSession
    skillName: string
    reason?: string
    takeaway?: string
    stillRelevant?: boolean
  }): Promise<void>
}

export function createInMemoryStudioSkillStateStore(): StudioSkillStateStore {
  const state = new Map<string, StudioSkillUsageSummary[]>()

  return {
    async list(session: StudioSession): Promise<StudioSkillUsageSummary[]> {
      return [...(state.get(session.id) ?? [])]
    },
    async record(input): Promise<void> {
      const nextEntry: StudioSkillUsageSummary = {
        sessionId: input.session.id,
        skillName: input.skillName,
        reason: input.reason,
        takeaway: input.takeaway,
        stillRelevant: input.stillRelevant,
        timestamp: new Date().toISOString()
      }
      const existing = state.get(input.session.id) ?? []
      state.set(input.session.id, [...existing, nextEntry].slice(-20))
    }
  }
}
