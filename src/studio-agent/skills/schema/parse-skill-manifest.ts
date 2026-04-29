import path from 'node:path'
import type {
  StudioSkillDiscoveryEntry,
  StudioSkillLayers,
  StudioSkillManifest,
  StudioSkillScope
} from './skill-types'

export interface ParsedSkillDocument {
  manifest: StudioSkillManifest
  body: string
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseSkillDocument(content: string, fallbackName?: string): ParsedSkillDocument {
  const match = content.match(FRONTMATTER_PATTERN)
  const body = match ? content.slice(match[0].length).trim() : content.trim()
  const frontmatter = match ? parseFrontmatter(match[1]) : {}

  return {
    manifest: normalizeManifest(frontmatter, fallbackName, body),
    body
  }
}

export function buildDiscoveryEntry(input: {
  directory: string
  entryFile: string
  content: string
  source: 'catalog' | 'workspace'
}): StudioSkillDiscoveryEntry {
  const parsed = parseSkillDocument(input.content, path.basename(input.directory))

  return {
    ...parsed.manifest,
    directory: input.directory,
    entryFile: input.entryFile,
    source: input.source
  }
}

const LAYER_HEADINGS: Array<{ key: keyof StudioSkillLayers; pattern: RegExp }> = [
  { key: 'role', pattern: /^##\s+Role\b/i },
  { key: 'workflow', pattern: /^##\s+Workflow\b/i },
  { key: 'construction', pattern: /^##\s+Construction\b/i },
  { key: 'style', pattern: /^##\s+Style\b/i },
  { key: 'shotHint', pattern: /^##\s+Shot\b/i },
]

/**
 * Parse a skill body into 5-layer structure (Role/Workflow/Construction/Style/Shot).
 * Returns null if none of the expected headings are found.
 */
export function parseSkillLayers(body: string): StudioSkillLayers | null {
  const lines = body.split(/\r?\n/)
  const sectionRanges: Array<{ key: keyof StudioSkillLayers; start: number; end: number }> = []

  for (let i = 0; i < lines.length; i++) {
    for (const heading of LAYER_HEADINGS) {
      if (heading.pattern.test(lines[i].trim())) {
        sectionRanges.push({ key: heading.key, start: i + 1, end: lines.length })
      }
    }
  }

  if (sectionRanges.length === 0) {
    return null
  }

  // Each section ends where the next section begins
  for (let i = 0; i < sectionRanges.length - 1; i++) {
    sectionRanges[i].end = sectionRanges[i + 1].start - 1
  }

  const layers: StudioSkillLayers = {
    role: '',
    workflow: '',
    construction: '',
    style: '',
    shotHint: '',
  }

  for (const range of sectionRanges) {
    const content = lines.slice(range.start, range.end).join('\n').trim()
    layers[range.key] = content
  }

  return layers
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = raw.split(/\r?\n/)
  let activeListKey: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const listItem = trimmed.match(/^-\s+(.+)$/)
    if (listItem && activeListKey) {
      const next = Array.isArray(result[activeListKey]) ? [...(result[activeListKey] as unknown[])] : []
      next.push(stripQuotes(listItem[1].trim()))
      result[activeListKey] = next
      continue
    }

    activeListKey = null
    const separatorIndex = line.indexOf(':')
    if (separatorIndex < 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    if (!key) {
      continue
    }

    if (!rawValue) {
      result[key] = []
      activeListKey = key
      continue
    }

    result[key] = parseScalarOrList(rawValue)
  }

  return result
}

function parseScalarOrList(rawValue: string): unknown {
  if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    const inner = rawValue.slice(1, -1).trim()
    if (!inner) {
      return []
    }

    return inner
      .split(',')
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean)
  }

  if (/^\d+$/.test(rawValue)) {
    return Number(rawValue)
  }

  return stripQuotes(rawValue)
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function normalizeManifest(
  frontmatter: Record<string, unknown>,
  fallbackName: string | undefined,
  body: string
): StudioSkillManifest {
  const name = typeof frontmatter.name === 'string' && frontmatter.name.trim()
    ? frontmatter.name.trim()
    : (fallbackName?.trim() || 'unnamed-skill')
  const description = typeof frontmatter.description === 'string' && frontmatter.description.trim()
    ? frontmatter.description.trim()
    : inferDescription(body, name)
  const scope = asScope(frontmatter.scope)
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : undefined
  const version = typeof frontmatter.version === 'string' || typeof frontmatter.version === 'number'
    ? frontmatter.version
    : undefined

  return {
    name,
    description,
    scope,
    tags,
    version
  }
}

function inferDescription(body: string, fallbackName: string): string {
  const line = body
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('#'))

  return line?.slice(0, 160) || `Skill ${fallbackName}`
}

function asScope(value: unknown): StudioSkillScope | undefined {
  return value === 'common' || value === 'plot' || value === 'manim'
    ? value
    : undefined
}
