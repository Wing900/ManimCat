import path from 'node:path'
import type {
  StudioSkillDiscoveryEntry,
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
