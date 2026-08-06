import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_OUTPUT_CHARS = 16000
const DEFAULT_MAX_WALK_FILES = 2000

export class WorkspacePathError extends Error {
  readonly targetPath: string
  readonly resolvedPath: string
  readonly workspaceRoot: string
  readonly allowedRoots: string[]

  constructor(input: {
    targetPath: string
    resolvedPath: string
    workspaceRoot: string
    allowedRoots: string[]
  }) {
    super('Path escapes workspace')
    this.name = 'WorkspacePathError'
    this.targetPath = input.targetPath
    this.resolvedPath = input.resolvedPath
    this.workspaceRoot = input.workspaceRoot
    this.allowedRoots = input.allowedRoots
  }
}

export async function readWorkspaceFile(
  baseDirectory: string,
  targetPath: string,
  options?: { allowedRoots?: string[] }
): Promise<{ absolutePath: string; content: string }> {
  const absolutePath = await resolveSafeWorkspacePath(baseDirectory, targetPath, options)
  const content = await readFile(absolutePath, 'utf8')
  return {
    absolutePath,
    content
  }
}

export async function listWorkspaceDirectory(
  baseDirectory: string,
  targetPath?: string,
  options?: { allowedRoots?: string[] }
): Promise<{ absolutePath: string; entries: string[] }> {
  const absolutePath = await resolveSafeWorkspacePath(baseDirectory, targetPath ?? '.', options)
  const entries = await readdir(absolutePath, { withFileTypes: true })

  return {
    absolutePath,
    entries: entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'} ${entry.name}`)
  }
}

export async function walkWorkspaceFiles(baseDirectory: string, startPath = '.'): Promise<string[]> {
  const root = await resolveSafeWorkspacePath(baseDirectory, startPath)
  const results: string[] = []
  await walkDirectory(baseDirectory, root, results)
  return results
}

export function resolveWorkspacePath(
  baseDirectory: string,
  targetPath: string,
  options?: { allowedRoots?: string[] }
): string {
  const workspaceRoot = path.resolve(baseDirectory)
  const allowedRoots = [workspaceRoot, ...(options?.allowedRoots ?? []).map((root) => path.resolve(root))]
  try {
    assertWorkspaceRelativePath(targetPath)
  } catch {
    throw new WorkspacePathError({
      targetPath,
      resolvedPath: path.resolve(workspaceRoot, targetPath),
      workspaceRoot,
      allowedRoots,
    })
  }

  const resolved = path.resolve(workspaceRoot, targetPath)

  for (const root of allowedRoots) {
    const relative = path.relative(root, resolved)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return resolved
    }
  }

  throw new WorkspacePathError({
    targetPath,
    resolvedPath: resolved,
    workspaceRoot,
    allowedRoots,
  })
}

export async function resolveSafeWorkspacePath(
  baseDirectory: string,
  targetPath: string,
  options?: { allowedRoots?: string[] }
): Promise<string> {
  const workspaceRoot = await realpath(path.resolve(baseDirectory))
  const lexicalPath = path.resolve(workspaceRoot, targetPath)
  const allowedRoots = [workspaceRoot, ...(options?.allowedRoots ?? []).map((root) => path.resolve(root))]
  try {
    assertWorkspaceRelativePath(targetPath)
  } catch {
    throw new WorkspacePathError({
      targetPath,
      resolvedPath: lexicalPath,
      workspaceRoot,
      allowedRoots,
    })
  }

  const existingPath = await findExistingPath(lexicalPath)
  const resolvedPath = existingPath ? await realpath(existingPath) : lexicalPath

  if (!isInsideAnyRoot(resolvedPath, allowedRoots)) {
    throw new WorkspacePathError({
      targetPath,
      resolvedPath,
      workspaceRoot,
      allowedRoots,
    })
  }

  return resolvedPath
}

export function toWorkspaceRelativePath(baseDirectory: string, absolutePath: string): string {
  const workspaceRoot = path.resolve(baseDirectory)
  const relative = path.relative(workspaceRoot, absolutePath)
  return relative || '.'
}

export function wildcardToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/')
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regexSource = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${regexSource}$`, 'i')
}

export function truncateToolText(value: string, maxChars = DEFAULT_MAX_OUTPUT_CHARS): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false }
  }

  return {
    text: `${value.slice(0, maxChars)}\n\n[truncated]`,
    truncated: true
  }
}

async function walkDirectory(baseDirectory: string, directory: string, results: string[]): Promise<void> {
  if (results.length >= DEFAULT_MAX_WALK_FILES) {
    return
  }

  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (results.length >= DEFAULT_MAX_WALK_FILES) {
      return
    }

    if (entry.isSymbolicLink()) {
      continue
    }

    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(baseDirectory, absolutePath, results)
      continue
    }

    results.push(toWorkspaceRelativePath(baseDirectory, absolutePath).replace(/\\/g, '/'))
  }
}

function assertWorkspaceRelativePath(targetPath: string): void {
  if (typeof targetPath !== 'string' || targetPath.includes('\0')) {
    throw new Error('Workspace path must be a non-empty relative path without null bytes')
  }

  if (
    !targetPath.trim()
    || path.isAbsolute(targetPath)
    || path.win32.isAbsolute(targetPath)
    || /^[A-Za-z]:/.test(targetPath)
    || targetPath.startsWith('\\\\')
  ) {
    throw new Error(`Workspace path must be relative: ${targetPath}`)
  }
}

function isInsideAnyRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => {
    const relative = path.relative(root, candidate)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
}

async function findExistingPath(candidate: string): Promise<string | null> {
  let current = candidate
  while (true) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error
      }

      const parent = path.dirname(current)
      if (parent === current) {
        return null
      }
      current = parent
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
