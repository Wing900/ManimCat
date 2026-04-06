import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { StudioSession } from '../../domain/types'
import { parseSkillDocument } from '../schema/parse-skill-manifest'
import type { StudioResolvedSkill } from '../schema/skill-types'
import type { StudioSkillRegistry } from '../registry/skill-registry'

const DEFAULT_MAX_FILES = 10

export function createStudioSkillLoader(input: {
  registry: StudioSkillRegistry
  maxFiles?: number
}) {
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES

  return {
    async resolve(name: string, session: StudioSession): Promise<StudioResolvedSkill> {
      const entry = await input.registry.findByName(name, session)
      if (!entry) {
        throw new Error(`Skill not found: ${name}`)
      }

      const content = await readFile(entry.entryFile, 'utf8')
      const parsed = parseSkillDocument(content, path.basename(entry.directory))
      const files = await sampleFiles(entry.directory, maxFiles)

      return {
        ...entry,
        content,
        body: parsed.body,
        files
      }
    }
  }
}

async function sampleFiles(root: string, maxFiles: number): Promise<string[]> {
  const results: string[] = []
  await walkFiles(root, results, maxFiles)
  return results
}

async function walkFiles(directory: string, results: string[], maxFiles: number): Promise<void> {
  if (results.length >= maxFiles) {
    return
  }

  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (results.length >= maxFiles) {
      return
    }

    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await walkFiles(fullPath, results, maxFiles)
      continue
    }

    results.push(fullPath)
  }
}
