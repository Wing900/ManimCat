import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { StudioSession } from '../../domain/types'
import { logPlotStudioSkillTrace } from '../../observability/plot-studio-skill-trace'
import { parseSkillDocument, parseSkillLayers } from '../schema/parse-skill-manifest'
import type { StudioResolvedSkill, StudioShot } from '../schema/skill-types'
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
      const layers = parseSkillLayers(parsed.body)
      const shots = await loadShots(entry.directory)

      const resolved = {
        ...entry,
        content,
        body: parsed.body,
        files,
        layers: layers ?? undefined,
        shots,
      }

      logPlotStudioSkillTrace(session.studioKind, 'skill.resolve.completed', {
        sessionId: session.id,
        requestedSkillName: name,
        resolvedSkillName: resolved.name,
        entryFile: resolved.entryFile,
        fileCount: resolved.files.length,
        hasLayers: Boolean(layers),
        shotCount: shots.length,
      })

      return resolved
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

async function loadShots(skillDirectory: string): Promise<StudioShot[]> {
  const shotsDir = path.join(skillDirectory, 'shots')
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(shotsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const shots: StudioShot[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue
    }
    const fullPath = path.join(shotsDir, entry.name)
    const content = await readFile(fullPath, 'utf8')
    shots.push({
      name: entry.name.replace(/\.md$/, ''),
      content,
      path: fullPath,
    })
  }

  return shots
}
