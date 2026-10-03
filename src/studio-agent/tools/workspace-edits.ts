import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { StudioWorkspaceWriteAccessPolicy } from '../domain/run-execution-scope'
import { resolveAuthorizedWorkspaceTarget } from './workspace-access-policy'

/**
 * Workspace mutations. Authorization happens exactly once per call, at the top of the call, and
 * every later step uses the absolute path that authorization returned — a mutation never
 * re-resolves the model path through a weaker helper after the check.
 *
 * `access` is a required argument by design: a caller that lost the Run's execution scope must fail
 * to compile instead of silently mutating with whole-Session authority.
 */

export async function writeWorkspaceFile(input: {
  baseDirectory: string
  targetPath: string
  content: string
  access: StudioWorkspaceWriteAccessPolicy
}): Promise<{ absolutePath: string; bytes: number }> {
  const target = await resolveAuthorizedWorkspaceTarget({
    baseDirectory: input.baseDirectory,
    targetPath: input.targetPath,
    access: input.access
  })
  return writeAuthorizedWorkspaceFile(target.absolutePath, input.content)
}

export async function replaceInWorkspaceFile(input: {
  baseDirectory: string
  targetPath: string
  search: string
  replace: string
  replaceAll?: boolean
  access: StudioWorkspaceWriteAccessPolicy
}): Promise<{ absolutePath: string; content: string; replacements: number }> {
  const target = await resolveAuthorizedWorkspaceTarget({
    baseDirectory: input.baseDirectory,
    targetPath: input.targetPath,
    access: input.access
  })
  const current = await readFile(target.absolutePath, 'utf8')
  const replacements = countOccurrences(current, input.search)
  if (replacements === 0) {
    throw new Error(`Search text not found in ${input.targetPath}`)
  }

  const nextContent = input.replaceAll
    ? current.split(input.search).join(input.replace)
    : current.replace(input.search, input.replace)

  // Same authorized target as the read above: no second authorization, no re-resolution.
  await writeAuthorizedWorkspaceFile(target.absolutePath, nextContent)
  return {
    absolutePath: target.absolutePath,
    content: nextContent,
    replacements: input.replaceAll ? replacements : 1
  }
}

export async function applyWorkspacePatch(input: {
  baseDirectory: string
  targetPath: string
  patches: Array<{ search: string; replace: string; replaceAll?: boolean }>
  access: StudioWorkspaceWriteAccessPolicy
}): Promise<{ absolutePath: string; replacements: number; content: string }> {
  const target = await resolveAuthorizedWorkspaceTarget({
    baseDirectory: input.baseDirectory,
    targetPath: input.targetPath,
    access: input.access
  })
  let current = await readFile(target.absolutePath, 'utf8')
  let replacements = 0

  for (const patch of input.patches) {
    const count = countOccurrences(current, patch.search)
    if (count === 0) {
      throw new Error(`Patch search text not found in ${input.targetPath}`)
    }

    current = patch.replaceAll
      ? current.split(patch.search).join(patch.replace)
      : current.replace(patch.search, patch.replace)
    replacements += patch.replaceAll ? count : 1
  }

  await writeAuthorizedWorkspaceFile(target.absolutePath, current)
  return { absolutePath: target.absolutePath, replacements, content: current }
}

/**
 * Atomic replace on an already-authorized absolute path: the temporary file is created beside the
 * lexical target and renamed onto that same lexical target.
 */
async function writeAuthorizedWorkspaceFile(absolutePath: string, content: string): Promise<{ absolutePath: string; bytes: number }> {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, absolutePath)
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
  return {
    absolutePath,
    bytes: Buffer.byteLength(content, 'utf8')
  }
}

function countOccurrences(source: string, search: string): number {
  if (!search) {
    throw new Error('Search text must not be empty')
  }

  let count = 0
  let start = 0
  while (true) {
    const index = source.indexOf(search, start)
    if (index < 0) {
      return count
    }
    count += 1
    start = index + Math.max(1, search.length)
  }
}
