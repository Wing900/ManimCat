import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import {
  hasSessionRelativeTraversalSegment,
  isSameSessionRelativePath,
  normalizeSessionRelativePath,
  type StudioWorkspaceWriteAccessPolicy
} from '../domain/run-execution-scope'
import { resolveSafeWorkspacePath, WorkspacePathError } from './workspace-paths'

/**
 * One enforcement layer for workspace mutation authority.
 *
 * `write`, `edit` and `apply_patch` all authorize through `resolveAuthorizedWorkspaceTarget`, so a
 * Scene Run can mutate exactly one file and a Legacy Run keeps the pre-existing whole-workspace
 * behavior. A root would grant a subtree; this policy grants one exact file instead.
 *
 * The filesystem rules for one exact existing file live in exactly one place,
 * `verifyExactWorkspaceFile`: the Session root resolves, the normalized target stays inside it, the
 * target exists, the target is a regular file, the target is not a symbolic link, and no existing
 * ancestor below the Session root is a symbolic link. The runtime preflight that validates a
 * Scene's current source and the mutation authorization both call it, so a write is never verified
 * with weaker rules than a Run preflight.
 *
 * Filesystem TOCTOU boundary, stated honestly: the checks below run before the atomic rename, and
 * no directory or file handle is held across validation and replacement, so a concurrent local
 * process that swaps a directory for a symlink between the checks and the rename is not fenced by
 * the operating system. What is guaranteed is that the *lexical* target verified here is the
 * target written: the temporary file is created beside it and renamed onto it.
 */

export type StudioWorkspaceWriteDenialReason =
  | 'empty_target'
  | 'absolute_target'
  | 'traversal_target'
  | 'not_authorized_target'
  | 'missing_target'
  | 'not_regular_file'
  | 'symlink_target'
  | 'symlink_ancestor'
  | 'outside_workspace'

/**
 * Stable denial error. `targetPath` is the model-supplied relative target (or a placeholder when
 * the model supplied something that is not a relative path at all) and `reason` is a closed enum,
 * so neither the message nor the tool event can leak an absolute server path.
 */
export class StudioWorkspaceWriteDeniedError extends Error {
  readonly name = 'StudioWorkspaceWriteDeniedError'
  readonly targetPath: string
  readonly reason: StudioWorkspaceWriteDenialReason
  readonly policy: StudioWorkspaceWriteAccessPolicy['write']

  constructor(input: {
    targetPath: string
    reason: StudioWorkspaceWriteDenialReason
    policy: StudioWorkspaceWriteAccessPolicy['write']
  }) {
    super(studioWorkspaceWriteDeniedMessage(input.reason, input.targetPath))
    this.targetPath = input.targetPath
    this.reason = input.reason
    this.policy = input.policy
  }
}

function studioWorkspaceWriteDeniedMessage(
  reason: StudioWorkspaceWriteDenialReason,
  targetPath: string
): string {
  const suffix = targetPath ? `: ${targetPath}` : ''
  if (reason === 'empty_target') {
    return `Workspace write rejected, the target must be a non-empty relative path${suffix}`
  }
  if (reason === 'absolute_target') {
    return 'Workspace write rejected, an absolute or drive-qualified target is never accepted'
  }
  if (reason === 'traversal_target') {
    return `Workspace write rejected, traversal segments are never accepted${suffix}`
  }
  if (reason === 'not_authorized_target') {
    return `Workspace write rejected, this Run may only modify its own current scene source${suffix}`
  }
  if (reason === 'missing_target') {
    return `Workspace write rejected, the target file does not exist${suffix}`
  }
  if (reason === 'not_regular_file') {
    return `Workspace write rejected, the target is not a regular file${suffix}`
  }
  if (reason === 'symlink_target') {
    return `Workspace write rejected, a symbolic link is never a writable target${suffix}`
  }
  if (reason === 'symlink_ancestor') {
    return `Workspace write rejected, a parent directory is a symbolic link${suffix}`
  }
  return `Workspace write rejected, the target leaves the workspace${suffix}`
}

export interface StudioAuthorizedWorkspaceTarget {
  /** Absolute lexical path proven to be the authorized target. */
  absolutePath: string
  /** Normalized Session-relative path of the authorized target. */
  relativePath: string
}

/** One workspace file proven to exist, to be a regular file, and to sit below a symlink-free path. */
export interface StudioVerifiedWorkspaceFile {
  /** Absolute lexical path of the verified file: the exact path a caller may use. */
  absolutePath: string
  /** Normalized Session-relative path of the verified file. */
  relativePath: string
  /** Real path of the Session root the file was verified against. */
  sessionRoot: string
}

/**
 * Authorizes one workspace mutation and returns the exact path it may touch.
 *
 * `session-workspace` keeps the existing boundary (`resolveSafeWorkspacePath`) so Legacy behavior
 * is unchanged, including creating a new file. `exact-file` additionally requires the normalized
 * requested path to equal the authorized path and then delegates to `verifyExactWorkspaceFile`,
 * which is the single filesystem validator shared with the runtime preflight.
 */
export async function resolveAuthorizedWorkspaceTarget(input: {
  baseDirectory: string
  targetPath: string
  access: StudioWorkspaceWriteAccessPolicy
}): Promise<StudioAuthorizedWorkspaceTarget> {
  const access = input.access
  if (access.write === 'session-workspace') {
    try {
      const absolutePath = await resolveSafeWorkspacePath(input.baseDirectory, input.targetPath)
      const relativePath = normalizeSessionRelativePath(input.targetPath)
      return { absolutePath, relativePath: relativePath ?? input.targetPath }
    } catch (error) {
      throw toDenialError(error, input.targetPath, access.write)
    }
  }

  // Exact-file mode refuses traversal syntax outright, even when it would normalize onto the
  // authorized path: one canonical spelling is easier to audit than a set of equivalent ones.
  if (hasSessionRelativeTraversalSegment(input.targetPath)) {
    throw new StudioWorkspaceWriteDeniedError({
      targetPath: sanitizeTargetPath(input.targetPath),
      reason: 'traversal_target',
      policy: access.write
    })
  }

  const requestedRelativePath = normalizeSessionRelativePath(input.targetPath)
  if (!requestedRelativePath) {
    throw new StudioWorkspaceWriteDeniedError({
      targetPath: sanitizeTargetPath(input.targetPath),
      reason: isPathLikeAbsolute(input.targetPath) ? 'absolute_target' : 'empty_target',
      policy: access.write
    })
  }

  if (!isSameSessionRelativePath(requestedRelativePath, access.relativePath)) {
    throw new StudioWorkspaceWriteDeniedError({
      targetPath: requestedRelativePath,
      reason: 'not_authorized_target',
      policy: access.write
    })
  }

  const verified = await verifyExactWorkspaceFile({
    baseDirectory: input.baseDirectory,
    relativePath: requestedRelativePath,
    policy: access.write
  })
  return { absolutePath: verified.absolutePath, relativePath: verified.relativePath }
}

/**
 * The single filesystem validator for one exact workspace file.
 *
 * Used by mutation authorization (a model-supplied target that must equal the authorized Scene
 * source) and by the runtime preflight (a persisted Scene `sourcePath` that must be a real file
 * before the provider is invoked). It never returns the caller's input: the returned absolute path
 * is derived from the real Session root, so a caller that stores persisted path text cannot smuggle
 * a foreign or absolute path into a later write.
 */
export async function verifyExactWorkspaceFile(input: {
  baseDirectory: string
  relativePath: string
  policy: StudioWorkspaceWriteAccessPolicy['write']
}): Promise<StudioVerifiedWorkspaceFile> {
  if (hasSessionRelativeTraversalSegment(input.relativePath)) {
    throw new StudioWorkspaceWriteDeniedError({
      targetPath: sanitizeTargetPath(input.relativePath),
      reason: 'traversal_target',
      policy: input.policy
    })
  }

  const relativePath = normalizeSessionRelativePath(input.relativePath)
  if (!relativePath) {
    throw new StudioWorkspaceWriteDeniedError({
      targetPath: sanitizeTargetPath(input.relativePath),
      reason: isPathLikeAbsolute(input.relativePath) ? 'absolute_target' : 'empty_target',
      policy: input.policy
    })
  }

  // The boundary runs first: it rejects absolute, drive-qualified, UNC and null-byte targets, and
  // proves the lexical path's nearest existing ancestor stays inside the Session root.
  let sessionRoot: string
  try {
    await resolveSafeWorkspacePath(input.baseDirectory, relativePath)
    sessionRoot = await realpath(path.resolve(input.baseDirectory))
  } catch (error) {
    throw toDenialError(error, relativePath, input.policy)
  }

  const absolutePath = path.join(sessionRoot, ...relativePath.split('/'))
  await assertExactRegularFile({ absolutePath, targetPath: relativePath, policy: input.policy })
  await assertNoSymlinkAncestor({
    absolutePath,
    sessionRoot,
    targetPath: relativePath,
    policy: input.policy
  })

  return { absolutePath, relativePath, sessionRoot }
}

async function assertExactRegularFile(input: {
  absolutePath: string
  targetPath: string
  policy: StudioWorkspaceWriteAccessPolicy['write']
}): Promise<void> {
  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(input.absolutePath)
  } catch {
    throw new StudioWorkspaceWriteDeniedError({
      targetPath: input.targetPath,
      reason: 'missing_target',
      policy: input.policy
    })
  }

  if (stats.isSymbolicLink()) {
    throw new StudioWorkspaceWriteDeniedError({
      targetPath: input.targetPath,
      reason: 'symlink_target',
      policy: input.policy
    })
  }
  if (!stats.isFile()) {
    throw new StudioWorkspaceWriteDeniedError({
      targetPath: input.targetPath,
      reason: 'not_regular_file',
      policy: input.policy
    })
  }
}

async function assertNoSymlinkAncestor(input: {
  absolutePath: string
  sessionRoot: string
  targetPath: string
  policy: StudioWorkspaceWriteAccessPolicy['write']
}): Promise<void> {
  const parentChain: string[] = []
  let current = path.dirname(input.absolutePath)
  while (isInsideRoot(current, input.sessionRoot) && current !== input.sessionRoot) {
    parentChain.push(current)
    const next = path.dirname(current)
    if (next === current) {
      break
    }
    current = next
  }

  for (const directory of parentChain) {
    try {
      const stats = await lstat(directory)
      if (stats.isSymbolicLink()) {
        throw new StudioWorkspaceWriteDeniedError({
          targetPath: input.targetPath,
          reason: 'symlink_ancestor',
          policy: input.policy
        })
      }
    } catch (error) {
      if (error instanceof StudioWorkspaceWriteDeniedError) {
        throw error
      }
      throw new StudioWorkspaceWriteDeniedError({
        targetPath: input.targetPath,
        reason: 'missing_target',
        policy: input.policy
      })
    }
  }
}

function toDenialError(
  error: unknown,
  targetPath: string,
  policy: StudioWorkspaceWriteAccessPolicy['write']
): StudioWorkspaceWriteDeniedError {
  const sanitized = sanitizeTargetPath(targetPath)
  if (error instanceof WorkspacePathError) {
    return new StudioWorkspaceWriteDeniedError({
      targetPath: sanitized,
      reason: isPathLikeAbsolute(error.targetPath) ? 'absolute_target' : 'outside_workspace',
      policy
    })
  }

  return new StudioWorkspaceWriteDeniedError({
    targetPath: sanitized,
    reason: isPathLikeAbsolute(targetPath) ? 'absolute_target' : 'outside_workspace',
    policy
  })
}

function sanitizeTargetPath(targetPath: unknown): string {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return ''
  }
  const relative = normalizeSessionRelativePath(targetPath)
  return relative ?? ''
}

function isPathLikeAbsolute(targetPath: unknown): boolean {
  if (typeof targetPath !== 'string') {
    return false
  }
  const trimmed = targetPath.trim()
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    /^[A-Za-z]:/.test(trimmed) ||
    path.isAbsolute(trimmed)
  )
}

function isInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
