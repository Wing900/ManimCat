import { execFile } from 'node:child_process'
import path from 'node:path'
import type { RuntimeManimCatalog } from './types'

const MAX_CATALOG_BYTES = 64 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60_000

let sharedCatalog: Promise<RuntimeManimCatalog> | undefined

function validateCatalog(value: unknown): RuntimeManimCatalog {
  const catalog = value as Partial<RuntimeManimCatalog>
  if (
    catalog.schemaVersion !== 1 ||
    typeof catalog.manimVersion !== 'string' ||
    !catalog.symbols ||
    !catalog.aliasIndex
  ) {
    throw new Error('Runtime Manim catalog has an invalid schema')
  }
  return catalog as RuntimeManimCatalog
}

function generateCatalog(): Promise<RuntimeManimCatalog> {
  const python = process.env.MANIM_PYTHON_BIN?.trim() || process.env.PYTHON_BIN?.trim() || 'python'
  const script = path.join(process.cwd(), 'scripts', 'manim-api-catalog.py')
  const timeout = Number.parseInt(
    process.env.MANIM_API_CATALOG_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    10
  )

  return new Promise((resolve, reject) => {
    execFile(
      python,
      [script],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: MAX_CATALOG_BYTES,
        timeout,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Unable to generate Manim runtime catalog: ${error.message}; ${stderr.trim()}`))
          return
        }
        try {
          resolve(validateCatalog(JSON.parse(stdout)))
        } catch (parseError) {
          reject(new Error(`Unable to parse Manim runtime catalog: ${String(parseError)}`))
        }
      }
    )
  })
}

export function loadRuntimeManimCatalog(): Promise<RuntimeManimCatalog> {
  if (!sharedCatalog) {
    sharedCatalog = generateCatalog().catch((error) => {
      sharedCatalog = undefined
      throw error
    })
  }
  return sharedCatalog
}

export function clearRuntimeManimCatalogCache(): void {
  sharedCatalog = undefined
}
