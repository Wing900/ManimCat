import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '../../../utils/logger'
import type { PythonRuntimeCatalog, PythonRuntimeSymbolRecord } from './python-runtime-catalog-types'

const logger = createLogger('RuntimeMatplotlibCatalog')

export const MATPLOTLIB_PACKAGE_NAME = 'matplotlib'
export const MATPLOTLIB_CATALOG_SCRIPT = path.join('scripts', 'matplotlib-api-catalog.py')

const MAX_CATALOG_BYTES = 64 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 10 * 60_000

export type MatplotlibCatalogLoader = () => Promise<PythonRuntimeCatalog>

let sharedCatalog: Promise<PythonRuntimeCatalog> | undefined

/**
 * Python selection comes from trusted process configuration only. No request field,
 * model output, or session data may influence the executable.
 */
export function resolveMatplotlibCatalogPython(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.PLOT_PYTHON_BIN?.trim()
    || env.PYTHON_EXECUTABLE?.trim()
    || env.PYTHON_BIN?.trim()
    || 'python'
}

export function resolveMatplotlibCatalogTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const parsed = Number.parseInt(env.MATPLOTLIB_API_CATALOG_TIMEOUT_MS ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.min(Math.max(parsed, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}

/**
 * Process-owned matplotlibrc/cache directory. Keeps catalog generation out of the
 * user workspace and out of any request-controlled path.
 */
export function resolveMatplotlibConfigDir(): string {
  return path.join(os.tmpdir(), 'manimcat-matplotlib-config')
}

const CATALOG_SCHEMA_ERROR = 'Runtime matplotlib catalog has an invalid schema'

const SYMBOL_KINDS = new Set(['class', 'function', 'module', 'constant'])
const MEMBER_KINDS = new Set(['property', 'staticmethod', 'classmethod', 'method', 'attribute'])
const OPTIONAL_SYMBOL_TEXT_FIELDS = ['signature', 'doc', 'value'] as const
const OPTIONAL_MEMBER_TEXT_FIELDS = ['signature', 'doc'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function hasOwnKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/**
 * Complete structural validation of a generated catalog. Only trusted generator output
 * reaches this function, but a truncated or partially-written payload must never enter
 * the cache: every nested union, alias target and member record is checked here.
 *
 * The thrown error is always the same generic message; malformed values are never
 * echoed back into it.
 */
export function validateRuntimeMatplotlibCatalog(value: unknown): PythonRuntimeCatalog {
  if (!isPlainObject(value)) {
    throw new Error(CATALOG_SCHEMA_ERROR)
  }
  if (value.schemaVersion !== 1) {
    throw new Error(CATALOG_SCHEMA_ERROR)
  }
  if (value.packageName !== MATPLOTLIB_PACKAGE_NAME) {
    throw new Error(CATALOG_SCHEMA_ERROR)
  }
  if (!isNonEmptyString(value.packageVersion) || !isNonEmptyString(value.pythonVersion)) {
    throw new Error(CATALOG_SCHEMA_ERROR)
  }
  const moduleCount = value.moduleCount
  if (!Number.isInteger(moduleCount) || (moduleCount as number) <= 0) {
    throw new Error(CATALOG_SCHEMA_ERROR)
  }
  if (!isPlainObject(value.moduleErrors) || !isPlainObject(value.symbols) || !isPlainObject(value.aliasIndex)) {
    throw new Error(CATALOG_SCHEMA_ERROR)
  }

  const symbols = value.symbols
  const aliasIndex = value.aliasIndex
  const symbolPaths = Object.keys(symbols)
  if (symbolPaths.length === 0) {
    throw new Error(CATALOG_SCHEMA_ERROR)
  }

  for (const [moduleName, message] of Object.entries(value.moduleErrors)) {
    if (!isNonEmptyString(moduleName) || typeof message !== 'string') {
      throw new Error(CATALOG_SCHEMA_ERROR)
    }
  }

  for (const canonicalPath of symbolPaths) {
    if (!isNonEmptyString(canonicalPath)) {
      throw new Error(CATALOG_SCHEMA_ERROR)
    }
    const symbol = symbols[canonicalPath]
    if (!isPlainObject(symbol)) {
      throw new Error(CATALOG_SCHEMA_ERROR)
    }
    if (!isNonEmptyString(symbol.name) || !isNonEmptyString(symbol.path) || symbol.path !== canonicalPath) {
      throw new Error(CATALOG_SCHEMA_ERROR)
    }
    if (!isNonEmptyString(symbol.kind) || !SYMBOL_KINDS.has(symbol.kind)) {
      throw new Error(CATALOG_SCHEMA_ERROR)
    }
    if (!Array.isArray(symbol.aliases) || !symbol.aliases.every(isNonEmptyString)) {
      throw new Error(CATALOG_SCHEMA_ERROR)
    }
    for (const field of OPTIONAL_SYMBOL_TEXT_FIELDS) {
      const optionalText = symbol[field]
      if (optionalText !== undefined && typeof optionalText !== 'string') {
        throw new Error(CATALOG_SCHEMA_ERROR)
      }
    }
    if (symbol.mro !== undefined) {
      if (!Array.isArray(symbol.mro) || !symbol.mro.every(isNonEmptyString)) {
        throw new Error(CATALOG_SCHEMA_ERROR)
      }
    }
    if (symbol.members !== undefined) {
      if (!isPlainObject(symbol.members)) {
        throw new Error(CATALOG_SCHEMA_ERROR)
      }
      for (const [memberName, member] of Object.entries(symbol.members)) {
        if (!isNonEmptyString(memberName) || !isPlainObject(member)) {
          throw new Error(CATALOG_SCHEMA_ERROR)
        }
        if (!isNonEmptyString(member.kind) || !MEMBER_KINDS.has(member.kind)) {
          throw new Error(CATALOG_SCHEMA_ERROR)
        }
        if (!isNonEmptyString(member.owner)) {
          throw new Error(CATALOG_SCHEMA_ERROR)
        }
        for (const field of OPTIONAL_MEMBER_TEXT_FIELDS) {
          const optionalText = member[field]
          if (optionalText !== undefined && typeof optionalText !== 'string') {
            throw new Error(CATALOG_SCHEMA_ERROR)
          }
        }
      }
    }
  }

  for (const [alias, target] of Object.entries(aliasIndex)) {
    if (!isNonEmptyString(alias) || !isNonEmptyString(target) || !hasOwnKey(symbols, target)) {
      throw new Error(CATALOG_SCHEMA_ERROR)
    }
  }

  for (const canonicalPath of symbolPaths) {
    if (aliasIndex[canonicalPath] !== canonicalPath) {
      throw new Error(CATALOG_SCHEMA_ERROR)
    }
    const { aliases } = symbols[canonicalPath] as PythonRuntimeSymbolRecord
    for (const alias of aliases) {
      if (aliasIndex[alias] !== canonicalPath) {
        throw new Error(CATALOG_SCHEMA_ERROR)
      }
    }
  }

  return value as unknown as PythonRuntimeCatalog
}

function generateCatalog(): Promise<PythonRuntimeCatalog> {
  const python = resolveMatplotlibCatalogPython()
  const script = path.join(process.cwd(), MATPLOTLIB_CATALOG_SCRIPT)

  return new Promise((resolve, reject) => {
    execFile(
      python,
      [script],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: MAX_CATALOG_BYTES,
        timeout: resolveMatplotlibCatalogTimeoutMs(),
        windowsHide: true,
        env: {
          ...process.env,
          MPLBACKEND: 'Agg',
          MPLCONFIGDIR: resolveMatplotlibConfigDir(),
        },
      },
      (error, stdout) => {
        if (error) {
          // stderr, host paths and process output stay out of the error and out of Tool content.
          logger.error('Matplotlib runtime catalog generation failed', { code: error.code ?? null })
          reject(new Error('Unable to generate the matplotlib runtime catalog'))
          return
        }
        try {
          resolve(validateRuntimeMatplotlibCatalog(JSON.parse(stdout)))
        } catch {
          reject(new Error('Unable to parse the matplotlib runtime catalog'))
        }
      }
    )
  })
}

/**
 * Lazy, process-wide cached catalog. A failure clears the cache so a later lookup
 * can retry, and concurrent lookups share the in-flight promise.
 */
export function loadRuntimeMatplotlibCatalog(): Promise<PythonRuntimeCatalog> {
  if (!sharedCatalog) {
    sharedCatalog = generateCatalog().catch((error) => {
      sharedCatalog = undefined
      throw error
    })
  }
  return sharedCatalog
}

export function clearRuntimeMatplotlibCatalogCache(): void {
  sharedCatalog = undefined
}
