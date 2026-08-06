import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { resolveSafeWorkspacePath } from './workspace-paths'

export async function writeWorkspaceFile(
  baseDirectory: string,
  targetPath: string,
  content: string
): Promise<{ absolutePath: string; bytes: number }> {
  const absolutePath = await resolveSafeWorkspacePath(baseDirectory, targetPath)
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

export async function replaceInWorkspaceFile(input: {
  baseDirectory: string
  targetPath: string
  search: string
  replace: string
  replaceAll?: boolean
}): Promise<{ absolutePath: string; content: string; replacements: number }> {
  const absolutePath = await resolveSafeWorkspacePath(input.baseDirectory, input.targetPath)
  const current = await readFile(absolutePath, 'utf8')
  const replacements = countOccurrences(current, input.search)
  if (replacements === 0) {
    throw new Error(`Search text not found in ${input.targetPath}`)
  }

  const nextContent = input.replaceAll
    ? current.split(input.search).join(input.replace)
    : current.replace(input.search, input.replace)

  await writeWorkspaceFile(input.baseDirectory, input.targetPath, nextContent)
  return {
    absolutePath,
    content: nextContent,
    replacements: input.replaceAll ? replacements : 1
  }
}

export async function applyWorkspacePatch(input: {
  baseDirectory: string
  targetPath: string
  patches: Array<{ search: string; replace: string; replaceAll?: boolean }>
}): Promise<{ absolutePath: string; replacements: number; content: string }> {
  const absolutePath = await resolveSafeWorkspacePath(input.baseDirectory, input.targetPath)
  let current = await readFile(absolutePath, 'utf8')
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

  await writeWorkspaceFile(input.baseDirectory, input.targetPath, current)
  return { absolutePath, replacements, content: current }
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
