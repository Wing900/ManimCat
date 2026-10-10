import fs from 'node:fs/promises'
import path from 'node:path'
import {
  API_CATALOG_SCHEMA_VERSION,
  type ApiCatalog,
  type ApiCatalogKind,
  type ApiCatalogMemberKind,
  type ApiCatalogMemberRecord,
  type ApiCatalogPackage,
  type ApiCatalogSymbolRecord
} from './types'

/** Committed data root. Production never reads another directory. */
const API_CATALOG_ROOT = path.join(process.cwd(), 'data', 'api-catalog')

export function apiCatalogDirectory(packageName: ApiCatalogPackage): string {
  return path.join(API_CATALOG_ROOT, packageName)
}

export function baselineCatalogPath(packageName: ApiCatalogPackage): string {
  return path.join(apiCatalogDirectory(packageName), 'baseline.json')
}

export function searchCatalogPath(packageName: ApiCatalogPackage): string {
  return path.join(apiCatalogDirectory(packageName), 'search.json')
}

const SYMBOL_KINDS = new Set<ApiCatalogKind>(['class', 'function', 'module', 'constant'])
const MEMBER_KINDS = new Set<ApiCatalogMemberKind>([
  'property',
  'staticmethod',
  'classmethod',
  'method',
  'attribute'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Baseline catalog has an invalid schema: ${label} must be a string`)
  }
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  return requireString(value, label)
}

function validateSymbol(value: unknown, path: string): ApiCatalogSymbolRecord {
  if (!isRecord(value)) {
    throw new Error(`Baseline catalog has an invalid schema: symbol ${path} must be an object`)
  }
  const kind = requireString(value.kind, `${path}.kind`)
  if (!SYMBOL_KINDS.has(kind as ApiCatalogKind)) {
    throw new Error(`Baseline catalog has an invalid schema: symbol ${path} has kind ${kind}`)
  }
  if (!Array.isArray(value.aliases) || value.aliases.some((alias) => typeof alias !== 'string')) {
    throw new Error(`Baseline catalog has an invalid schema: symbol ${path}.aliases must be strings`)
  }

  const symbol: ApiCatalogSymbolRecord = {
    name: requireString(value.name, `${path}.name`),
    path: requireString(value.path, `${path}.path`),
    kind: kind as ApiCatalogKind,
    aliases: value.aliases as string[]
  }
  const signature = optionalString(value.signature, `${path}.signature`)
  const doc = optionalString(value.doc, `${path}.doc`)
  const symbolValue = optionalString(value.value, `${path}.value`)
  if (signature !== undefined) symbol.signature = signature
  if (doc !== undefined) symbol.doc = doc
  if (symbolValue !== undefined) symbol.value = symbolValue

  if (value.mro !== undefined) {
    if (!Array.isArray(value.mro) || value.mro.some((entry) => typeof entry !== 'string')) {
      throw new Error(`Baseline catalog has an invalid schema: symbol ${path}.mro must be strings`)
    }
    symbol.mro = value.mro as string[]
  }

  if (value.members !== undefined) {
    if (!isRecord(value.members)) {
      throw new Error(`Baseline catalog has an invalid schema: symbol ${path}.members must be an object`)
    }
    const members: Record<string, ApiCatalogMemberRecord> = {}
    for (const [memberName, member] of Object.entries(value.members)) {
      if (!isRecord(member)) {
        throw new Error(`Baseline catalog has an invalid schema: member ${path}.${memberName} must be an object`)
      }
      const memberKind = requireString(member.kind, `${path}.${memberName}.kind`)
      if (!MEMBER_KINDS.has(memberKind as ApiCatalogMemberKind)) {
        throw new Error(`Baseline catalog has an invalid schema: member ${path}.${memberName} has kind ${memberKind}`)
      }
      const record: ApiCatalogMemberRecord = {
        kind: memberKind as ApiCatalogMemberKind,
        owner: requireString(member.owner, `${path}.${memberName}.owner`)
      }
      const memberSignature = optionalString(member.signature, `${path}.${memberName}.signature`)
      const memberDoc = optionalString(member.doc, `${path}.${memberName}.doc`)
      if (memberSignature !== undefined) record.signature = memberSignature
      if (memberDoc !== undefined) record.doc = memberDoc
      members[memberName] = record
    }
    symbol.members = members
  }

  return symbol
}

/**
 * Strict shape check. A malformed catalog is a data defect and must stop the process:
 * a partially usable catalog would silently answer with invented APIs.
 */
export function validateBaselineCatalog(value: unknown, packageName: ApiCatalogPackage): ApiCatalog {
  if (!isRecord(value)) {
    throw new Error(`Baseline catalog for ${packageName} has an invalid schema: root must be an object`)
  }
  if (value.schemaVersion !== API_CATALOG_SCHEMA_VERSION) {
    throw new Error(
      `Baseline catalog for ${packageName} has an invalid schema: schemaVersion ${String(value.schemaVersion)} is not ${API_CATALOG_SCHEMA_VERSION}`
    )
  }
  if (!isRecord(value.symbols)) {
    throw new Error(`Baseline catalog for ${packageName} has an invalid schema: symbols must be an object`)
  }
  if (!isRecord(value.aliasIndex)) {
    throw new Error(`Baseline catalog for ${packageName} has an invalid schema: aliasIndex must be an object`)
  }
  if (!isRecord(value.moduleErrors)) {
    throw new Error(`Baseline catalog for ${packageName} has an invalid schema: moduleErrors must be an object`)
  }

  const symbols: Record<string, ApiCatalogSymbolRecord> = {}
  for (const [path, symbol] of Object.entries(value.symbols)) {
    symbols[path] = validateSymbol(symbol, path)
  }

  const aliasIndex: Record<string, string> = {}
  for (const [alias, canonical] of Object.entries(value.aliasIndex)) {
    aliasIndex[alias] = requireString(canonical, `aliasIndex.${alias}`)
  }

  return {
    schemaVersion: API_CATALOG_SCHEMA_VERSION,
    packageName: requireString(value.packageName, 'packageName'),
    packageVersion: requireString(value.packageVersion, 'packageVersion'),
    pythonVersion: requireString(value.pythonVersion, 'pythonVersion'),
    moduleCount: typeof value.moduleCount === 'number' ? value.moduleCount : 0,
    moduleErrors: value.moduleErrors as Record<string, string>,
    symbols,
    aliasIndex
  }
}

const baselineCache = new Map<ApiCatalogPackage, Promise<ApiCatalog>>()

async function readBaselineCatalog(packageName: ApiCatalogPackage): Promise<ApiCatalog> {
  const filePath = baselineCatalogPath(packageName)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`Baseline catalog is not readable at ${filePath}: ${String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`Baseline catalog at ${filePath} is not valid JSON: ${String(error)}`)
  }
  return validateBaselineCatalog(parsed, packageName)
}

export function loadBaselineCatalog(packageName: ApiCatalogPackage): Promise<ApiCatalog> {
  const cached = baselineCache.get(packageName)
  if (cached) {
    return cached
  }
  const pending = readBaselineCatalog(packageName).catch((error: unknown) => {
    baselineCache.delete(packageName)
    throw error
  })
  baselineCache.set(packageName, pending)
  return pending
}
