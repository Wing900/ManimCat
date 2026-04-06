import path from 'node:path'
import type { StudioSession } from '../../domain/types'
import type { StudioSkillDiscoveryEntry, StudioSkillSource } from '../schema/skill-types'
import { createFileSystemSkillSource } from './file-system-skill-source'

export interface StudioSkillRegistry {
  list(session: StudioSession): Promise<StudioSkillDiscoveryEntry[]>
  findByName(name: string, session: StudioSession): Promise<StudioSkillDiscoveryEntry | null>
}

export function createStudioSkillRegistry(
  sources: StudioSkillSource[] = createDefaultSkillSources()
): StudioSkillRegistry {
  return {
    async list(session: StudioSession): Promise<StudioSkillDiscoveryEntry[]> {
      const sourceEntries = await Promise.all(sources.map((source) => source.list(session)))
      const merged = mergeEntries(sourceEntries.flat())
      return merged.filter((entry) => matchesStudioScope(entry.scope, session.studioKind))
    },
    async findByName(name: string, session: StudioSession): Promise<StudioSkillDiscoveryEntry | null> {
      const entries = await this.list(session)
      return entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase()) ?? null
    }
  }
}

export function createDefaultSkillSources(): StudioSkillSource[] {
  const catalogRoot = path.join(process.cwd(), 'src', 'studio-agent', 'skills', 'catalog')

  return [
    createFileSystemSkillSource({
      rootDirectory: path.join(catalogRoot, 'common'),
      source: 'catalog'
    }),
    createFileSystemSkillSource({
      rootDirectory: (session) => path.join(catalogRoot, session.studioKind ?? 'manim'),
      source: 'catalog'
    }),
    createFileSystemSkillSource({
      rootDirectory: (session) => path.join(session.directory, '.manimcat', 'skills'),
      source: 'workspace'
    })
  ]
}

function mergeEntries(entries: StudioSkillDiscoveryEntry[]): StudioSkillDiscoveryEntry[] {
  const merged = new Map<string, StudioSkillDiscoveryEntry>()
  for (const entry of entries) {
    merged.set(entry.name.toLowerCase(), entry)
  }
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function matchesStudioScope(
  scope: StudioSkillDiscoveryEntry['scope'],
  studioKind: StudioSession['studioKind']
): boolean {
  if (!scope || scope === 'common') {
    return true
  }

  return scope === (studioKind ?? 'manim')
}
