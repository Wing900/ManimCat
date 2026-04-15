import { executeStudioImageInputCommand } from './handlers/image-input'
import { executeStudioSkillCommand } from './handlers/skill'
import type { StudioCommandDefinition, StudioImageInputCommand, StudioSkillCommand } from './types'

export const featureStudioCommands: StudioCommandDefinition[] = [
  {
    id: 'image-input',
    group: 'feature',
    scope: 'local',
    presentation: {
      trigger: '/p',
      titleKey: 'studio.command.imageTitle',
      descriptionKey: 'studio.command.imageDescription',
      aliases: ['/paint'],
      keywords: ['image', 'upload', 'canvas', 'reference'],
    },
    matches(input): StudioImageInputCommand | null {
      const normalized = input.trim().toLowerCase()
      if (normalized !== '/p' && normalized !== '/paint') {
        return null
      }

      return {
        id: 'image-input',
        group: 'feature',
        raw: normalized,
      }
    },
    execute: executeStudioImageInputCommand,
  },
  {
    id: 'skill',
    group: 'feature',
    scope: 'global',
    presentation: {
      trigger: '/skill',
      titleKey: 'studio.command.skillTitle',
      descriptionKey: 'studio.command.skillDescription',
      keywords: ['skill', 'prompt', 'catalog', 'guidance'],
    },
    matches(input): StudioSkillCommand | null {
      const normalized = input.trim()
      if (!/^\/skill(?:\s+.+)?$/i.test(normalized)) {
        return null
      }

      return {
        id: 'skill',
        group: 'feature',
        raw: normalized,
      }
    },
    execute: executeStudioSkillCommand,
  },
]
