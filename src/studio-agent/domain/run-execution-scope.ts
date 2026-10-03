/**
 * Immutable execution scope of one Studio Run.
 *
 * The scope answers a single question before the model is invoked: which files may this Run read,
 * which exact file may it mutate, and which Scene directory entries describe its neighbours. It is
 * assembled once per Run from the persisted Session, the persisted Run, the Scene store and the
 * filesystem, and is then passed through typed runtime fields only.
 *
 * This module is deliberately dependency-free: it holds transport-neutral types and pure helpers,
 * so both `runtime/**` and `tools/**` can import it without creating an import cycle, and it never
 * touches Redis, HTTP, React, a provider SDK or the filesystem. Orchestration (store reads,
 * logging) lives in `runtime/execution/run-execution-scope-loader.ts`; enforcement lives in
 * `tools/workspace-access-policy.ts`.
 */

/** One Scene of the owning Session, reduced to what a prompt may safely show. */
export interface StudioSceneDirectoryEntry {
  id: string
  position: number
  /** Normalized Session-relative path; never an absolute filesystem path. */
  sourceRelativePath: string
  isCurrent: boolean
}

/**
 * Write authority of a Run. `session-workspace` is the pre-existing whole-workspace behavior;
 * `exact-file` grants one normalized Session-relative path and nothing else. A root grants a
 * subtree, so subtree roots are never used to express write authority.
 */
export type StudioWorkspaceWriteAccessPolicy =
  | { readonly write: 'session-workspace' }
  | { readonly write: 'exact-file'; readonly relativePath: string }

export interface StudioLegacyRunExecutionScope {
  readonly kind: 'legacy-session'
  readonly rootDirectory: string
  readonly workspaceAccess: { readonly write: 'session-workspace' }
}

export interface StudioSceneRunExecutionScope {
  readonly kind: 'scene'
  readonly rootDirectory: string
  readonly sceneId: string
  /** Server-private absolute path of the current Scene source. Never handed to the model. */
  readonly currentSourcePath: string
  readonly currentSourceRelativePath: string
  readonly scenes: readonly StudioSceneDirectoryEntry[]
  readonly workspaceAccess: { readonly write: 'exact-file'; readonly relativePath: string }
}

export type StudioRunExecutionScope = StudioLegacyRunExecutionScope | StudioSceneRunExecutionScope

/** How many Scene directory entries the prompt block may carry before it is truncated. */
export const STUDIO_SCENE_DIRECTORY_PROMPT_LIMIT = 24

/** Longest accepted Scene/source identifier in a relative path segment set. */
const MAX_SESSION_RELATIVE_PATH_LENGTH = 1024

/**
 * Raised when a scope cannot be assembled safely. The message is stable and contains no absolute
 * filesystem path: a caller may surface it, and the failing detail stays in server logs.
 */
export class StudioRunExecutionScopeError extends Error {
  readonly reason: StudioRunExecutionScopeFailureReason
  readonly sceneId?: string

  constructor(reason: StudioRunExecutionScopeFailureReason, sceneId?: string) {
    super(studioRunExecutionScopeErrorMessage(reason))
    this.name = 'StudioRunExecutionScopeError'
    this.reason = reason
    this.sceneId = sceneId
  }
}

export type StudioRunExecutionScopeFailureReason =
  | 'scene_not_found'
  | 'scene_store_unavailable'
  | 'unsafe_scene_source'

export function studioRunExecutionScopeErrorMessage(reason: StudioRunExecutionScopeFailureReason): string {
  if (reason === 'scene_not_found') {
    return 'Scene scope could not be resolved for this Run'
  }
  if (reason === 'scene_store_unavailable') {
    return 'Scene scope is unavailable in this configuration'
  }
  return 'Scene source path is not a usable workspace-relative path'
}

export function createLegacyRunExecutionScope(input: { rootDirectory: string }): StudioLegacyRunExecutionScope {
  return Object.freeze({
    kind: 'legacy-session' as const,
    rootDirectory: input.rootDirectory,
    workspaceAccess: Object.freeze({ write: 'session-workspace' as const })
  })
}

export function createSceneRunExecutionScope(input: {
  rootDirectory: string
  sceneId: string
  currentSourcePath: string
  currentSourceRelativePath: string
  scenes: readonly StudioSceneDirectoryEntry[]
  relativePath: string
}): StudioSceneRunExecutionScope {
  const relativePath = normalizeSessionRelativePath(input.relativePath)
  if (!relativePath) {
    throw new StudioRunExecutionScopeError('unsafe_scene_source', input.sceneId)
  }

  // The scope is an immutable snapshot: a later mutation of the caller's own input, of the
  // returned `scenes` array, or of the write policy cannot widen a Run's authority.
  return Object.freeze({
    kind: 'scene' as const,
    rootDirectory: input.rootDirectory,
    sceneId: input.sceneId,
    currentSourcePath: input.currentSourcePath,
    currentSourceRelativePath: relativePath,
    scenes: Object.freeze(
      orderSceneDirectoryEntries(input.scenes).map((entry) => Object.freeze({ ...entry }))
    ),
    workspaceAccess: Object.freeze({ write: 'exact-file' as const, relativePath })
  })
}

export function isSceneRunExecutionScope(
  scope: StudioRunExecutionScope
): scope is StudioSceneRunExecutionScope {
  return scope.kind === 'scene'
}

/** The write policy of a scope, suitable as the `access` bag of the workspace policy module. */
export function studioWorkspaceWriteAccessOf(
  scope: StudioRunExecutionScope
): StudioWorkspaceWriteAccessPolicy {
  return scope.workspaceAccess
}

/**
 * Normalizes a Session-relative path, or returns `null` when the input cannot be one.
 *
 * Rejected: empty/whitespace-only input, null bytes, absolute paths (POSIX, drive-qualified and
 * UNC), and any `..` segment that would escape the root. Separators are unified to `/`, `.`
 * segments are dropped, and the result never carries a leading `./`.
 */
export function normalizeSessionRelativePath(targetPath: string): string | null {
  if (typeof targetPath !== 'string') {
    return null
  }
  if (targetPath.includes('\0')) {
    return null
  }

  const trimmed = targetPath.trim()
  if (!trimmed || trimmed.length > MAX_SESSION_RELATIVE_PATH_LENGTH) {
    return null
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[A-Za-z]:/.test(trimmed)) {
    return null
  }

  const segments: string[] = []
  for (const segment of trimmed.split(/[\\/]+/)) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return null
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return segments.length ? segments.join('/') : null
}

/**
 * True when a Session-relative path spelling carries a `..` segment.
 *
 * The syntax rule is deliberately separator-agnostic and platform-independent: `/` and `\` are both
 * treated as separators, so `scenes/../x.py` and `scenes\..\x.py` are rejected identically on Linux
 * and on Windows. This single implementation is shared by the runtime preflight (which validates a
 * persisted Scene source) and the mutation authorization (which validates a model-supplied target),
 * so the two can never drift apart.
 */
export function hasSessionRelativeTraversalSegment(targetPath: unknown): boolean {
  if (typeof targetPath !== 'string') {
    return false
  }
  return targetPath.split(/[\\/]+/).some((segment) => segment === '..')
}

/**
 * Platform-correct comparison of two normalized Session-relative paths. Windows and macOS
 * default filesystems compare case-insensitively; Linux compares byte-exactly.
 */
export function isSameSessionRelativePath(left: string, right: string): boolean {
  const normalizedLeft = normalizeSessionRelativePath(left)
  const normalizedRight = normalizeSessionRelativePath(right)
  if (!normalizedLeft || !normalizedRight) {
    return false
  }
  if (normalizedLeft === normalizedRight) {
    return true
  }
  return isCaseInsensitivePlatform()
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : false
}

function isCaseInsensitivePlatform(): boolean {
  const platform = typeof process === 'undefined' ? '' : process.platform
  return platform === 'win32' || platform === 'darwin'
}

/** Deterministic directory order: `position` first, `id` as the tie-breaker. */
export function orderSceneDirectoryEntries(
  entries: readonly StudioSceneDirectoryEntry[]
): StudioSceneDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position
    }
    return left.id.localeCompare(right.id)
  })
}

/**
 * Bounded prompt projection of the Scene directory. Truncation is deterministic (the ordered head
 * is kept) and explicitly reported so the model can tell a capped list from a complete one.
 */
export function truncateSceneDirectory(
  entries: readonly StudioSceneDirectoryEntry[],
  limit = STUDIO_SCENE_DIRECTORY_PROMPT_LIMIT
): { entries: StudioSceneDirectoryEntry[]; truncated: boolean; omittedCount: number } {
  const ordered = orderSceneDirectoryEntries(entries)
  const bounded = limit >= 0 ? limit : 0
  if (ordered.length <= bounded) {
    return { entries: ordered, truncated: false, omittedCount: 0 }
  }

  return {
    entries: ordered.slice(0, bounded),
    truncated: true,
    omittedCount: ordered.length - bounded
  }
}
