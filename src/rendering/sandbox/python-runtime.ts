/**
 * Resolve an explicit Python runtime for a sandboxed render.
 *
 * The renderer must come from an explicit executable or the project's exact
 * `.venv`; a local venv is mounted read-only as one directory, never its parent.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface PythonRuntime {
  executable: string
  /** Exact directories that must be mounted read-only inside the sandbox. */
  mountDirectories: string[]
  /** PATH entries that make the runtime and its sibling tools available. */
  pathEntries: string[]
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate)
    if (!stat.isFile()) return false
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveFromPath(command: string): string | undefined {
  if (command.includes('/') || command.includes('\\')) {
    const resolved = path.resolve(command)
    return isExecutableFile(resolved) ? resolved : undefined
  }
  for (const entry of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, command)
    if (isExecutableFile(candidate)) return path.resolve(candidate)
  }
  return undefined
}

function venvRootForExecutable(executable: string): string | undefined {
  const binDirectory = path.dirname(executable)
  const binName = path.basename(binDirectory)
  if (binName !== 'bin' && binName !== 'Scripts') return undefined
  const root = path.dirname(binDirectory)
  try {
    if (fs.statSync(path.join(root, 'pyvenv.cfg')).isFile()) return root
  } catch {
    // Not a virtual environment; the system runtime paths still apply.
  }
  return undefined
}

function runtimeForExecutable(executable: string): PythonRuntime {
  const resolved = path.resolve(executable)
  if (!isExecutableFile(resolved)) {
    throw new Error(`Configured Python runtime is missing or not executable: ${resolved}`)
  }

  const mountDirectories: string[] = []
  const venvRoot = venvRootForExecutable(resolved)
  if (venvRoot) {
    // Exact venv only. Mounting its parent would expose unrelated files.
    mountDirectories.push(venvRoot)
  }

  return {
    executable: resolved,
    mountDirectories: Array.from(new Set(mountDirectories)),
    pathEntries: Array.from(new Set([path.dirname(resolved), '/usr/local/bin', '/usr/bin', '/bin'])),
  }
}

/**
 * Resolution order: explicit option, named environment variable, project venv,
 * then an absolute PATH lookup. The result is always executed inside bwrap.
 */
export function resolvePythonRuntime(
  options: {
    explicit?: string
    envName?: string
    env?: NodeJS.ProcessEnv
  } = {}
): PythonRuntime {
  const env = options.env ?? process.env
  const explicit = options.explicit?.trim()
  if (explicit) {
    const resolved = resolveFromPath(explicit)
    if (!resolved) {
      throw new Error(`Configured Python runtime is missing or not executable: ${explicit}`)
    }
    return runtimeForExecutable(resolved)
  }

  if (options.envName) {
    const configured = env[options.envName]?.trim()
    if (configured) {
      const resolved = resolveFromPath(configured)
      if (!resolved) {
        throw new Error(
          `${options.envName} points to a missing or non-executable Python runtime: ${configured}`
        )
      }
      return runtimeForExecutable(resolved)
    }
  }

  const localPython = path.resolve(
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  )
  if (isExecutableFile(localPython)) {
    return runtimeForExecutable(localPython)
  }

  for (const candidate of ['python3', 'python']) {
    const resolved = resolveFromPath(candidate)
    if (resolved) return runtimeForExecutable(resolved)
  }

  throw new Error('No Python runtime found. Set MANIMGX_PYTHON or create .venv with requirements.txt.')
}
