import fs from 'node:fs'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '../../utils/logger'
import { createStudioScene, createStudioSceneId } from '../domain/factories'
import type { StudioRender, StudioScene, StudioSceneSnapshot } from '../domain/types'
import type { StudioPersistence } from '../persistence/studio-persistence'
import type { StudioRenderResultReconciler } from '../render/render-result-reconciler'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'
import { resolveSafeWorkspacePath } from '../tools/workspace-paths'
import {
  StudioSceneOrderRejectedError,
  type StudioSceneOrderRejection,
} from './studio-scene-order-error'

const logger = createLogger('StudioSceneService')

/** Directory holding Scene sources, relative to the owning Session directory. */
export const STUDIO_SCENE_DIRECTORY = 'scenes'

/**
 * Minimal deterministic Scene source: valid Python, no generated semantic name, and nothing
 * that a later Task has to strip. The Scene number is positional and changes on reorder, so it
 * must never be baked into the file.
 */
export const STUDIO_SCENE_SOURCE_TEMPLATE =
  '"""Studio scene source file. Filled in when the scene receives its first instruction."""\n'

/** Python module stem shape: a plain identifier, so `import scene_...` always resolves. */
const STUDIO_SCENE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface StudioCreateSceneInput {
  ownerId: string
  sessionId: string
}

export type StudioCreateSceneOutcome =
  | { status: 'created'; scene: StudioScene }
  | { status: 'session_not_found' }
  /** A source file already occupies the Scene path: nothing was overwritten or persisted. */
  | { status: 'source_conflict' }
  /** The workspace boundary rejected the source path, or the file could not be created. */
  | { status: 'source_rejected' }
  /** The record could not be persisted; the freshly created source file was removed. */
  | { status: 'persistence_failed' }

export interface StudioReorderScenesInput {
  ownerId: string
  sessionId: string
  sceneIds: readonly string[]
}

export type StudioReorderScenesOutcome =
  | { status: 'reordered'; scenes: StudioScene[] }
  | { status: 'session_not_found' }
  | { status: 'invalid_order'; reason: StudioSceneOrderRejection }
  | { status: 'persistence_failed' }

export interface StudioSceneService {
  createScene: (input: StudioCreateSceneInput) => Promise<StudioCreateSceneOutcome>
  getScene: (ownerId: string, sceneId: string) => Promise<StudioScene | null>
  listScenes: (ownerId: string, sessionId: string) => Promise<StudioScene[]>
  reorderScenes: (input: StudioReorderScenesInput) => Promise<StudioReorderScenesOutcome>
  /**
   * Scene-scoped read model. `null` covers every inaccessible case (absent Session, absent
   * Scene, foreign owner, Scene of another Session) so callers cannot distinguish them.
   */
  getSceneSnapshot: (ownerId: string, sessionId: string, sceneId: string) => Promise<StudioSceneSnapshot | null>
}

export function createStudioSceneService(input: {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
  /**
   * Render result reconciliation, if this runtime has a job store to ask. Optional so a runtime
   * without one keeps answering stored records exactly as before.
   */
  renderResultReconciler?: StudioRenderResultReconciler
  /**
   * Scene id source. Injectable so a composition root can pin deterministic ids; the default
   * keeps the production `scene_<hex>` shape.
   */
  generateSceneId?: () => string
}): StudioSceneService {
  const { persistence, workspaceProvider } = input

  async function createScene(createInput: StudioCreateSceneInput): Promise<StudioCreateSceneOutcome> {
    const session = await persistence.sessionStore.getById(createInput.ownerId, createInput.sessionId)
    if (!session) {
      return { status: 'session_not_found' }
    }
    if (!session.directory.trim()) {
      return { status: 'source_rejected' }
    }

    const sceneId = (input.generateSceneId ?? createStudioSceneId)()
    if (!STUDIO_SCENE_ID_PATTERN.test(sceneId)) {
      return { status: 'source_rejected' }
    }

    // The boundary is applied to the *existing* Session root, never to the not-yet-created
    // `scenes` directory: it realpaths the root and proves the target's nearest existing
    // ancestor stays inside it, so an existing `scenes` symlink that escapes the root is
    // rejected before anything is created. It only resolves existing paths, so the file path
    // itself is derived from that same root and the same relative target.
    const sessionDirectory = workspaceProvider.normalizeDirectory(session.directory)
    const relativeSourcePath = path.join(STUDIO_SCENE_DIRECTORY, `${sceneId}.py`)
    let sourcePath: string
    try {
      await resolveSafeWorkspacePath(sessionDirectory, relativeSourcePath)
      sourcePath = path.resolve(sessionDirectory, relativeSourcePath)
    } catch (error) {
      logger.warn('Studio scene source path rejected', {
        sessionId: createInput.sessionId,
        reason: readErrorMessage(error),
      })
      return { status: 'source_rejected' }
    }

    const scenesDirectory = path.dirname(sourcePath)
    try {
      fs.mkdirSync(scenesDirectory, { recursive: true })
      // Containment proof for the directory the file is actually written into: realpath both
      // sides, so a `scenes` link created after the lexical check still fails closed.
      if (!(await isInsideDirectory(sessionDirectory, scenesDirectory))) {
        logger.warn('Studio scene directory escapes the session directory', {
          sessionId: createInput.sessionId,
        })
        return { status: 'source_rejected' }
      }
    } catch (error) {
      logger.warn('Studio scene directory could not be created', {
        sessionId: createInput.sessionId,
        reason: readErrorMessage(error),
      })
      return { status: 'source_rejected' }
    }

    try {
      // `wx` fails closed on an existing file: an occupied path is never truncated.
      fs.writeFileSync(sourcePath, STUDIO_SCENE_SOURCE_TEMPLATE, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return { status: 'source_conflict' }
      }
      logger.warn('Studio scene source could not be created', {
        sessionId: createInput.sessionId,
        reason: readErrorMessage(error),
      })
      return { status: 'source_rejected' }
    }

    const scene = createStudioScene({
      id: sceneId,
      ownerId: createInput.ownerId,
      sessionId: createInput.sessionId,
      position: 0,
      sourcePath,
    })
    // The store assigns the authoritative position; the factory value only satisfies the shape.
    const { position: _position, ...appendInput } = scene

    try {
      const stored = await persistence.sceneStore.append(appendInput)
      return { status: 'created', scene: stored }
    } catch (error) {
      logger.error('Studio scene persistence failed after source creation', {
        sessionId: createInput.sessionId,
        sceneId,
        reason: readErrorMessage(error),
      })
      removeCreatedSourceFile(sourcePath)
      return { status: 'persistence_failed' }
    }
  }

  async function getSceneSnapshot(
    ownerId: string,
    sessionId: string,
    sceneId: string
  ): Promise<StudioSceneSnapshot | null> {
    const session = await persistence.sessionStore.getById(ownerId, sessionId)
    if (!session) {
      return null
    }

    const scene = await persistence.sceneStore.getById(ownerId, sceneId)
    // Owner-scoped read plus an explicit Session cross-check: a Scene of another Session of the
    // same owner is as inaccessible as a foreign one and must not become a readable snapshot.
    if (!scene || scene.sessionId !== session.id) {
      return null
    }

    const [messages, runs, storedRenders] = await Promise.all([
      persistence.messageStore.listBySceneId(scene.id),
      persistence.runStore.listBySceneId(ownerId, scene.id),
      persistence.renderStore.listBySceneId(ownerId, scene.id),
    ])

    // Read-triggered render reconciliation: the Studio render is completed by the Manim job, not by
    // the Agent Run, so the read model asks the job store about this Scene's unfinished Manim
    // renders before answering. A reconciler failure never breaks the read — the stored records are
    // still returned, which is the honest state, and the next read tries again.
    const renders = await reconcileSceneRenders(ownerId, scene, storedRenders)

    return { scene, messages, runs, renders }
  }

  async function reconcileSceneRenders(
    ownerId: string,
    scene: StudioScene,
    renders: readonly StudioRender[]
  ): Promise<StudioRender[]> {
    const reconciler = input.renderResultReconciler
    if (!reconciler) {
      return [...renders]
    }

    try {
      return await reconciler.reconcileSceneRenders({
        ownerId,
        sessionId: scene.sessionId,
        sceneId: scene.id,
        renders
      })
    } catch (error) {
      logger.warn('Studio scene render reconciliation failed', {
        sceneId: scene.id,
        reason: readErrorMessage(error)
      })
      return [...renders]
    }
  }

  async function classifyOrderRejection(    reorderInput: StudioReorderScenesInput,
    sceneIds: string[]
  ): Promise<StudioSceneOrderRejection | null> {
    if (!sceneIds.length) {
      return 'empty_order'
    }
    if (new Set(sceneIds).size !== sceneIds.length) {
      return 'duplicate_scene'
    }

    const persisted = await persistence.sceneStore.listBySessionId(reorderInput.ownerId, reorderInput.sessionId)
    const persistedIds = new Set(persisted.map((scene) => scene.id))
    for (const sceneId of sceneIds) {
      if (persistedIds.has(sceneId)) {
        continue
      }
      // A Scene of the same owner in another Session is `foreign_scene`; anything else — a
      // foreign owner or a nonexistent id — stays indistinguishable as `missing_scene`.
      const stored = await persistence.sceneStore.getById(reorderInput.ownerId, sceneId)
      return stored ? 'foreign_scene' : 'missing_scene'
    }

    return sceneIds.length === persisted.length ? null : 'incomplete_set'
  }

  async function reorderScenes(reorderInput: StudioReorderScenesInput): Promise<StudioReorderScenesOutcome> {
    const session = await persistence.sessionStore.getById(reorderInput.ownerId, reorderInput.sessionId)
    if (!session) {
      return { status: 'session_not_found' }
    }

    const sceneIds = [...reorderInput.sceneIds]
    const rejection = await classifyOrderRejection(reorderInput, sceneIds)
    if (rejection) {
      return { status: 'invalid_order', reason: rejection }
    }

    try {
      const scenes = await persistence.sceneStore.replaceOrder(
        reorderInput.ownerId,
        reorderInput.sessionId,
        sceneIds
      )
      return { status: 'reordered', scenes }
    } catch (error) {
      if (error instanceof StudioSceneOrderRejectedError) {
        // The store is the atomic authority: a set that changed since the read is still rejected.
        return { status: 'invalid_order', reason: error.reason }
      }
      logger.error('Studio scene reorder failed', {
        sessionId: reorderInput.sessionId,
        reason: readErrorMessage(error),
      })
      return { status: 'persistence_failed' }
    }
  }

  return {
    createScene,
    getScene: (ownerId, sceneId) => persistence.sceneStore.getById(ownerId, sceneId),
    listScenes: (ownerId, sessionId) => persistence.sceneStore.listBySessionId(ownerId, sessionId),
    reorderScenes,
    getSceneSnapshot,
  }
}

/** Compensates only the file this call created; siblings and pre-existing files stay untouched. */
function removeCreatedSourceFile(sourcePath: string): void {
  try {
    if (fs.existsSync(sourcePath)) {
      fs.rmSync(sourcePath, { force: true })
    }
  } catch (error) {
    logger.warn('Studio scene source compensation failed', { reason: readErrorMessage(error) })
  }
}

/** Realpath containment: the directory the file is written into must stay beneath the Session root. */
async function isInsideDirectory(rootDirectory: string, candidateDirectory: string): Promise<boolean> {
  try {
    const [root, candidate] = await Promise.all([realpath(rootDirectory), realpath(candidateDirectory)])
    const relative = path.relative(root, candidate)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  } catch {
    return false
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false
  }
  return (error as { code?: unknown }).code === 'EEXIST'
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
