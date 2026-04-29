import type { StudioSession } from '../../domain/types'
import type { StudioResolvedSkill, StudioSkillUsageSummary } from '../schema/skill-types'

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

/**
 * Stores active skills per session.
 * Skills persist until a new session resets the state.
 */
export interface ActiveSkillStore {
  get(sessionId: string): StudioResolvedSkill[]
  set(sessionId: string, skill: StudioResolvedSkill): void
  has(sessionId: string, skillName: string): boolean
  clearShots(sessionId: string): void
}

export function createInMemoryActiveSkillStore(): ActiveSkillStore {
  const store = new Map<string, Map<string, StudioResolvedSkill>>()

  return {
    get(sessionId: string): StudioResolvedSkill[] {
      const sessionSkills = store.get(sessionId)
      return sessionSkills ? [...sessionSkills.values()] : []
    },
    set(sessionId: string, skill: StudioResolvedSkill): void {
      if (!store.has(sessionId)) {
        store.set(sessionId, new Map())
      }
      store.get(sessionId)!.set(skill.name, skill)
    },
    has(sessionId: string, skillName: string): boolean {
      return store.get(sessionId)?.has(skillName) ?? false
    },
    clearShots(sessionId: string): void {
      const sessionSkills = store.get(sessionId)
      if (!sessionSkills) {
        return
      }
      for (const [name, skill] of sessionSkills) {
        if (skill.shots?.length) {
          sessionSkills.set(name, { ...skill, shots: [] })
        }
      }
    },
  }
}
