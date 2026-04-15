import { allStudioCommands } from '../all-commands'
import type { StudioSkillDiscoveryEntry } from '../../protocol/studio-agent-types'
import type { StudioCommandGroup, StudioCommandPresentation } from '../types'

export interface StudioCommandSuggestion extends StudioCommandPresentation {
  id: string
  group: StudioCommandGroup
  inputValue?: string
  detail?: string
  badge?: string
}

export const allStudioCommandSuggestions: StudioCommandSuggestion[] = allStudioCommands.map((command, index) => ({
  id: `${command.id}-${index}`,
  group: command.group,
  inputValue: command.presentation.trigger,
  ...command.presentation,
}))

export function getStudioCommandSuggestions(input: string, maxItems = 8): StudioCommandSuggestion[] {
  const normalized = normalizeCommandInput(input)
  if (!normalized) {
    return []
  }

  if (allStudioCommandSuggestions.some((item) => item.trigger.toLowerCase() === normalized)) {
    return []
  }

  return allStudioCommandSuggestions
    .map((item) => ({
      item,
      score: scoreSuggestion(item, normalized),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.item.trigger.localeCompare(right.item.trigger)
    })
    .slice(0, maxItems)
    .map((entry) => entry.item)
}

export function getStudioSkillSuggestions(
  input: string,
  skills: StudioSkillDiscoveryEntry[],
  maxItems = 8,
): StudioCommandSuggestion[] {
  const match = input.match(/^\/skill(?:\s+(.*))?$/i)
  if (!match) {
    return []
  }

  const normalizedInput = input.trim().toLowerCase()
  const query = (match[1] ?? '').trim().toLowerCase()

  if (skills.some((skill) => `/skill ${skill.name}`.toLowerCase() === normalizedInput)) {
    return []
  }

  return skills
    .map((skill) => {
      const score = scoreSkillSuggestion(skill, query)
      return { skill, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.skill.name.localeCompare(right.skill.name)
    })
    .slice(0, maxItems)
    .map(({ skill }) => ({
      id: `skill-${skill.name}`,
      group: 'feature',
      trigger: skill.name,
      inputValue: `/skill ${skill.name}`,
      titleKey: 'studio.command.skillItemTitle',
      descriptionKey: 'studio.command.skillItemDescription',
      detail: skill.description,
      badge: [skill.scope ?? 'common', skill.source].join(' / '),
    }))
}

function normalizeCommandInput(input: string) {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed.startsWith('/')) {
    return null
  }
  return trimmed
}

function scoreSuggestion(item: StudioCommandSuggestion, query: string) {
  const trigger = item.trigger.toLowerCase()
  const aliases = item.aliases?.map((alias) => alias.toLowerCase()) ?? []
  const keywords = item.keywords?.map((keyword) => keyword.toLowerCase()) ?? []
  const searchTerm = query.slice(1)

  if (query === '/') {
    return 100 - trigger.length
  }

  if (trigger === query) {
    return 1000
  }

  if (trigger.startsWith(query)) {
    return 800 - (trigger.length - query.length)
  }

  for (const alias of aliases) {
    if (alias === query) {
      return 720
    }
    if (alias.startsWith(query)) {
      return 620 - (alias.length - query.length)
    }
  }

  if (searchTerm.length >= 2 && keywords.some((keyword) => keyword.includes(searchTerm))) {
    return 220
  }

  if (trigger.includes(query)) {
    return 180
  }

  return 0
}

function scoreSkillSuggestion(skill: StudioSkillDiscoveryEntry, query: string) {
  if (!query) {
    return 700
  }

  const name = skill.name.toLowerCase()
  const description = skill.description.toLowerCase()
  const tags = skill.tags?.map((tag) => tag.toLowerCase()) ?? []

  if (name === query) {
    return 1000
  }

  if (name.startsWith(query)) {
    return 900 - (name.length - query.length)
  }

  if (tags.some((tag) => tag.includes(query))) {
    return 500
  }

  if (description.includes(query)) {
    return 320
  }

  if (name.includes(query)) {
    return 240
  }

  return 0
}
