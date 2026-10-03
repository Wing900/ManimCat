import path from 'node:path'
import { createLogger } from '../../../utils/logger'
import type { StudioScene, StudioSceneStore, StudioSession } from '../../domain/types'
import {
  createLegacyRunExecutionScope,
  createSceneRunExecutionScope,
  hasSessionRelativeTraversalSegment,
  normalizeSessionRelativePath,
  StudioRunExecutionScopeError,
  type StudioRunExecutionScope,
  type StudioSceneDirectoryEntry
} from '../../domain/run-execution-scope'
import {
  StudioWorkspaceWriteDeniedError,
  verifyExactWorkspaceFile,
  type StudioWorkspaceWriteDenialReason
} from '../../tools/workspace-access-policy'

const logger = createLogger('StudioRunExecutionScope')

/**
 * Assembles the immutable execution scope of one Run.
 *
 * Reads the persisted Scene store only; the caller (the prepared Run context) has already proved
 * that the Session and the Run exist. A Scene Run fails closed before the model is invoked when its
 * current Scene is missing, foreign, or carries a source path that is not a real workspace file: the
 * current source is validated with the same filesystem validator the mutating Tools use, so the Run
 * can never start against a path that would later be rejected for writing. An unusable sibling path
 * is dropped with a sanitized log line instead, because one broken neighbour must not stop the Run.
 */
export async function loadStudioRunExecutionScope(input: {
  session: StudioSession
  sceneId?: string
  sceneStore?: StudioSceneStore
}): Promise<StudioRunExecutionScope> {
  const rootDirectory = input.session.directory
  if (!input.sceneId) {
    return createLegacyRunExecutionScope({ rootDirectory })
  }

  if (!input.sceneStore) {
    throw new StudioRunExecutionScopeError('scene_store_unavailable', input.sceneId)
  }

  const scene = await input.sceneStore.getById(input.session.ownerId, input.sceneId)
  if (!scene || scene.sessionId !== input.session.id) {
    throw new StudioRunExecutionScopeError('scene_not_found', input.sceneId)
  }

  const verifiedCurrentSource = await verifyCurrentSceneSource({
    rootDirectory,
    sessionId: input.session.id,
    scene
  })

  const siblings = await input.sceneStore.listBySessionId(input.session.ownerId, input.session.id)
  const scenes = buildSceneDirectoryEntries({
    rootDirectory,
    scenes: siblings,
    currentSceneId: scene.id,
    sessionId: input.session.id
  })

  return createSceneRunExecutionScope({
    rootDirectory,
    sceneId: scene.id,
    currentSourcePath: verifiedCurrentSource.absolutePath,
    currentSourceRelativePath: verifiedCurrentSource.relativePath,
    scenes,
    relativePath: verifiedCurrentSource.relativePath
  })
}

/**
 * Validates the current Scene source as a real workspace file before the provider is invoked.
 *
 * `verifyExactWorkspaceFile` is the single filesystem validator of the workspace access policy, so
 * preflight and mutation authorization cannot drift into two algorithms. Every failure — unusable
 * persisted path, missing file, directory, symbolic link, symlink ancestor, escaping path — becomes
 * one sanitized `unsafe_scene_source` failure.
 */
async function verifyCurrentSceneSource(input: {
  rootDirectory: string
  sessionId: string
  scene: StudioScene
}): Promise<{ absolutePath: string; relativePath: string }> {
  const fail = (denialReason: StudioWorkspaceWriteDenialReason | 'unusable_source_path'): never => {
    // Sanitized by design: the reason is a closed enum and the absolute path stays out of the log.
    logger.warn('Studio scene current source rejected', {
      sessionId: input.sessionId,
      sceneId: input.scene.id,
      reason: 'unsafe_scene_source',
      denialReason
    })
    throw new StudioRunExecutionScopeError('unsafe_scene_source', input.scene.id)
  }

  const relativePath = readSceneSourceRelativePath(input.rootDirectory, input.scene)
  if (!relativePath) {
    return fail('unusable_source_path')
  }

  try {
    const verified = await verifyExactWorkspaceFile({
      baseDirectory: input.rootDirectory,
      relativePath,
      policy: 'exact-file'
    })
    return { absolutePath: verified.absolutePath, relativePath: verified.relativePath }
  } catch (error) {
    return fail(error instanceof StudioWorkspaceWriteDeniedError ? error.reason : 'unusable_source_path')
  }
}

function buildSceneDirectoryEntries(input: {
  rootDirectory: string
  scenes: readonly StudioScene[]
  currentSceneId: string
  sessionId: string
}): StudioSceneDirectoryEntry[] {
  const entries: StudioSceneDirectoryEntry[] = []
  for (const scene of input.scenes) {
    const sourceRelativePath = readSceneSourceRelativePath(input.rootDirectory, scene)
    if (!sourceRelativePath) {
      // Sanitized by design: the absolute path stays out of the log payload.
      logger.warn('Studio scene directory entry omitted', {
        sessionId: input.sessionId,
        sceneId: scene.id,
        reason: 'unsafe_scene_source'
      })
      continue
    }

    entries.push({
      id: scene.id,
      position: scene.position,
      sourceRelativePath,
      isCurrent: scene.id === input.currentSceneId
    })
  }

  return entries
}

/**
 * Session-relative form of a Scene source path, or `null` when it is not a usable workspace path.
 * Pure string work: the store keeps absolute paths, and only the relative form may leave this
 * module.
 *
 * The raw persisted value is checked for a parent segment *before* any resolve or normalize, because
 * `path.resolve` erases `..` and would let `scenes/../scenes/scene_0001.py` masquerade as the
 * legitimate file it happens to normalize onto. The separator rule is shared with the mutation
 * policy, so both reject `..` and `\..\` identically on every platform. An absolute persisted path
 * stays supported; only a parent segment inside it is refused.
 */
function readSceneSourceRelativePath(rootDirectory: string, scene: StudioScene): string | null {
  if (typeof scene.sourcePath !== 'string' || !scene.sourcePath.trim()) {
    return null
  }
  if (typeof rootDirectory !== 'string' || !rootDirectory.trim()) {
    return null
  }

  if (hasSessionRelativeTraversalSegment(scene.sourcePath)) {
    return null
  }

  const root = path.resolve(rootDirectory)
  const absoluteSource = path.resolve(root, scene.sourcePath)
  const relative = path.relative(root, absoluteSource)
  // The resolved form is checked as well: an absolute persisted path outside the Session root only
  // becomes visible as a parent segment once it is made relative to the root.
  if (hasSessionRelativeTraversalSegment(relative)) {
    return null
  }
  return normalizeSessionRelativePath(relative)
}
