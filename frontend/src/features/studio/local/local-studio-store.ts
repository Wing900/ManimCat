/**
 * The Studio local store: every piece of a Session lives in the user's own browser.
 *
 * Records keep the *protocol* shapes (`StudioSession`, `StudioScene`, `StudioSceneMessage`,
 * `StudioSceneRender`) instead of a parallel local model, so a record that arrives from the server can
 * be persisted as-is and sent back up without a translation layer — a translation layer here would be
 * a second place for the shape to drift.
 *
 * Only two things are local additions: a Scene carries its `code` (on the server that lived in a file
 * on disk), and a Render carries the fingerprint of what it was rendered from (which is how freshness
 * is decided).
 */

import type {
  StudioScene,
  StudioSceneMessage,
  StudioSceneRender,
  StudioSession,
  StudioKind,
} from '../protocol/studio-agent-types'
import {
  LOCAL_STUDIO_MESSAGES,
  LOCAL_STUDIO_RENDERS,
  LOCAL_STUDIO_SCENES,
  LOCAL_STUDIO_SESSIONS,
  LOCAL_STUDIO_TRASH,
  LOCAL_STUDIO_VIDEOS,
  LOCAL_STUDIO_RUNS,
  openLocalStudioDb,
  promisifyRequest,
  runLocalTransaction,
} from './local-studio-db'
import { nextLocalSceneId } from './local-scene-ids'
import { nextLocalTrashId, type LocalRenderFingerprint } from './local-scene-state'

/** A Session as the browser keeps it. `directory` is a server-side concept, so it is not carried. */
export type LocalSession = Omit<StudioSession, 'directory'> & {
  /** Last time a Run touched this Session, which is what the server's temporary workspace TTL reads. */
  lastActiveAt: string
}

/** A Scene plus the code that used to live in `scenes/<id>.py` on the server. */
export type LocalScene = StudioScene & { code: string }

/** A Render plus what it was rendered from, and a pointer to the Blob it produced. */
export type LocalRender = StudioSceneRender & {
  fingerprint?: LocalRenderFingerprint
  videoRef?: string
}

export interface LocalTrashEntry {
  sessionId: string
  sceneId: string
  /** Falling-in order within one bin: 1, 2, 3. Never reused while the bin keeps its highest entry. */
  trashId: number
  code: string
  videoRef?: string
  fingerprint?: LocalRenderFingerprint
  createdAt: string
}

export interface LocalVideoRecord {
  id: string
  blob: Blob
  size: number
  mime: string
  createdAt: string
}

export interface LocalStudioStore {
  createSession(input: { kind: StudioKind; title: string }): Promise<LocalSession>
  getSession(sessionId: string): Promise<LocalSession | null>
  listSessions(kind: StudioKind): Promise<LocalSession[]>
  deleteSession(sessionId: string): Promise<void>

  createScene(sessionId: string): Promise<LocalScene>
  getScene(sessionId: string, sceneId: string): Promise<LocalScene | null>
  listScenes(sessionId: string): Promise<LocalScene[]>
  updateSceneCode(sessionId: string, sceneId: string, code: string): Promise<void>
  reorderScenes(sessionId: string, orderedSceneIds: string[]): Promise<void>

  appendMessage(message: StudioSceneMessage): Promise<void>
  listMessages(sessionId: string, sceneId: string): Promise<StudioSceneMessage[]>

  putRender(render: LocalRender): Promise<void>
  getRender(sessionId: string, renderId: string): Promise<LocalRender | null>
  putRenderVideo(render: LocalRender, blob: Blob, mime?: string): Promise<string>
  listRenders(sessionId: string, sceneId: string): Promise<LocalRender[]>

  putVideo(blob: Blob, mime?: string): Promise<string>
  getVideoUrl(videoRef: string): Promise<string | null>
  deleteVideo(videoRef: string): Promise<void>
  close(): Promise<void>

  putTrash(entry: LocalTrashEntry): Promise<void>
  listTrash(sessionId: string, sceneId: string): Promise<LocalTrashEntry[]>
  nextTrashId(sessionId: string, sceneId: string): Promise<number>
  deleteTrash(sessionId: string, sceneId: string, trashId: number): Promise<void>
}

export const LOCAL_STUDIO_SESSION_PREFIX = 'sess_'

export function createLocalStudioStore(factory: IDBFactory = indexedDB): LocalStudioStore {
  let database: Promise<IDBDatabase> | null = null
  let closed = false

  function db(): Promise<IDBDatabase> {
    if (closed) return Promise.reject(new Error('Local Studio store is closed'))
    database ??= openLocalStudioDb(factory)
    return database
  }

  // Every Scene of a Session, including the ones the caller is about to remove.
  async function readScenesOf(sessionId: string): Promise<LocalScene[]> {
    const handle = await db()
    return runLocalTransaction(handle, LOCAL_STUDIO_SCENES, 'readonly', (tx) =>
      promisifyRequest(tx.objectStore(LOCAL_STUDIO_SCENES).index('by-session').getAll(sessionId)),
    )
  }

  async function readScenesOfScene<T>(
    sessionId: string,
    sceneId: string,
    storeName: string,
  ): Promise<T[]> {
    const handle = await db()
    return runLocalTransaction(handle, storeName, 'readonly', (tx) =>
      promisifyRequest(tx.objectStore(storeName).index('by-scene').getAll([sessionId, sceneId])),
    )
  }

  return {
    async close() {
      closed = true
      if (database) (await database).close()
    },
    async createSession({ kind, title }) {
      const timestamp = new Date().toISOString()
      const session: LocalSession = {
        id: `${LOCAL_STUDIO_SESSION_PREFIX}${crypto.randomUUID()}`,
        projectId: 'local',
        studioKind: kind,
        agentType: 'builder',
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastActiveAt: timestamp,
      }

      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_SESSIONS, 'readwrite', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_SESSIONS).put(session)),
      )
      return session
    },

    async getSession(sessionId) {
      const handle = await db()
      const session = await runLocalTransaction(handle, LOCAL_STUDIO_SESSIONS, 'readonly', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_SESSIONS).get(sessionId)),
      )
      return session ?? null
    },

    async listSessions(kind) {
      const handle = await db()
      const sessions = await runLocalTransaction(handle, LOCAL_STUDIO_SESSIONS, 'readonly', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_SESSIONS).getAll()),
      )
      return sessions
        .filter((session) => session.studioKind === kind)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    },

    /**
     * Removes the Session and everything that belongs to it in one transaction: Scenes, messages,
     * renders, Recycle Bin entries, and the video bodies only those records referenced. A video body is
     * shared between a Scene's current render and its bin entries, so it is deleted last, by the ids
     * collected while the referencing records still existed.
     */
    async deleteSession(sessionId) {
      const handle = await db()
      await runLocalTransaction(
        handle,
        [
          LOCAL_STUDIO_SESSIONS,
          LOCAL_STUDIO_SCENES,
          LOCAL_STUDIO_MESSAGES,
          LOCAL_STUDIO_RENDERS,
          LOCAL_STUDIO_TRASH,
          LOCAL_STUDIO_RUNS,
          LOCAL_STUDIO_VIDEOS,
        ],
        'readwrite',
        async (tx) => {
          const videoIds = new Set<string>()

          // Captured server Renders can exist before any local Scene record is created.
          const sessionRenders: LocalRender[] = await promisifyRequest(tx.objectStore(LOCAL_STUDIO_RENDERS).getAll())
          for (const render of sessionRenders) {
            if (render.sessionId !== sessionId) continue
            if (render.videoRef) videoIds.add(render.videoRef)
            await promisifyRequest(tx.objectStore(LOCAL_STUDIO_RENDERS).delete([render.sessionId, render.id]))
          }

          for (const scene of await promisifyRequest(
            tx.objectStore(LOCAL_STUDIO_SCENES).index('by-session').getAll(sessionId),
          )) {
            const key = [scene.sessionId, scene.id]
            const renders: LocalRender[] = await promisifyRequest(
              tx.objectStore(LOCAL_STUDIO_RENDERS).index('by-scene').getAll(key),
            )
            const binEntries: LocalTrashEntry[] = await promisifyRequest(
              tx.objectStore(LOCAL_STUDIO_TRASH).index('by-scene').getAll(key),
            )
            for (const record of [...renders, ...binEntries]) {
              if (record.videoRef) {
                videoIds.add(record.videoRef)
              }
            }

            for (const render of renders) {
              await promisifyRequest(tx.objectStore(LOCAL_STUDIO_RENDERS).delete([render.sessionId, render.id]))
            }
            for (const entry of binEntries) {
              await promisifyRequest(
                tx.objectStore(LOCAL_STUDIO_TRASH).delete([entry.sessionId, entry.sceneId, entry.trashId]),
              )
            }
            for (const message of await promisifyRequest(
              tx.objectStore(LOCAL_STUDIO_MESSAGES).index('by-scene').getAll(key),
            )) {
              await promisifyRequest(tx.objectStore(LOCAL_STUDIO_MESSAGES).delete(message.id))
            }

            await promisifyRequest(tx.objectStore(LOCAL_STUDIO_SCENES).delete(key))
          }

          for (const videoId of videoIds) {
            await promisifyRequest(tx.objectStore(LOCAL_STUDIO_VIDEOS).delete(videoId))
          }

          await promisifyRequest(tx.objectStore(LOCAL_STUDIO_SESSIONS).delete(sessionId))
        },
      )
    },

    async createScene(sessionId) {
      const existing = await readScenesOf(sessionId)
      const timestamp = new Date().toISOString()
      const scene: LocalScene = {
        id: nextLocalSceneId(existing.map((scene) => scene.id)),
        sessionId,
        position: existing.reduce((highest, scene) => Math.max(highest, scene.position + 1), 0),
        code: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_SCENES, 'readwrite', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_SCENES).put(scene)),
      )
      return scene
    },

    async getScene(sessionId, sceneId) {
      const handle = await db()
      const scene = await runLocalTransaction(handle, LOCAL_STUDIO_SCENES, 'readonly', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_SCENES).get([sessionId, sceneId])),
      )
      return scene ?? null
    },

    async listScenes(sessionId) {
      const scenes = await readScenesOf(sessionId)
      return scenes.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    },

    async updateSceneCode(sessionId, sceneId, code) {
      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_SCENES, 'readwrite', async (tx) => {
        const store = tx.objectStore(LOCAL_STUDIO_SCENES)
        const scene: LocalScene | undefined = await promisifyRequest(store.get([sessionId, sceneId]))
        if (!scene) {
          throw new Error(`Unknown Scene ${sceneId} of Session ${sessionId}`)
        }
        await promisifyRequest(
          store.put({ ...scene, code, updatedAt: new Date().toISOString() }),
        )
      })
    },

    /**
     * Rewrites `position` only: ids and code are untouched, so reordering can never break a
     * cross-Scene import. The submitted list must be the exact Scene set of the Session, mirroring the
     * server-side order contract.
     */
    async reorderScenes(sessionId, orderedSceneIds) {
      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_SCENES, 'readwrite', async (tx) => {
        const store = tx.objectStore(LOCAL_STUDIO_SCENES)
        const existing: LocalScene[] = await promisifyRequest(store.index('by-session').getAll(sessionId))

        const existingIds = existing.map((scene) => scene.id).sort()
        const submittedIds = [...new Set(orderedSceneIds)].sort()
        if (
          submittedIds.length !== orderedSceneIds.length ||
          submittedIds.length !== existingIds.length ||
          submittedIds.some((id, index) => id !== existingIds[index])
        ) {
          throw new Error('The submitted order is not the Scene set of this Session')
        }

        for (const [position, sceneId] of orderedSceneIds.entries()) {
          const scene = existing.find((candidate) => candidate.id === sceneId)
          if (scene && scene.position !== position) {
            await promisifyRequest(store.put({ ...scene, position }))
          }
        }
      })
    },

    async appendMessage(message) {
      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_MESSAGES, 'readwrite', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_MESSAGES).put(message)),
      )
    },

    async listMessages(sessionId, sceneId) {
      const messages = await readScenesOfScene<StudioSceneMessage>(
        sessionId,
        sceneId,
        LOCAL_STUDIO_MESSAGES,
      )
      return messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    },

    async putRender(render) {
      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_RENDERS, 'readwrite', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_RENDERS).put(render)),
      )
    },

    async getRender(sessionId, renderId) {
      const handle = await db()
      return await runLocalTransaction(handle, LOCAL_STUDIO_RENDERS, 'readonly', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_RENDERS).get([sessionId, renderId])),
      ) ?? null
    },

    /** One commit owns both the video and its Render link; aborted writes leave neither behind. */
    async putRenderVideo(render, blob, mime) {
      const handle = await db()
      return runLocalTransaction(handle, [LOCAL_STUDIO_RENDERS, LOCAL_STUDIO_VIDEOS], 'readwrite', async (tx) => {
        const renders = tx.objectStore(LOCAL_STUDIO_RENDERS)
        const videos = tx.objectStore(LOCAL_STUDIO_VIDEOS)
        const existing: LocalRender | undefined = await promisifyRequest(renders.get([render.sessionId, render.id]))
        if (existing?.videoRef && await promisifyRequest(videos.get(existing.videoRef))) {
          return existing.videoRef
        }
        const video: LocalVideoRecord = {
          id: `vid_${crypto.randomUUID()}`, blob, size: blob.size,
          mime: mime ?? blob.type, createdAt: new Date().toISOString(),
        }
        await promisifyRequest(videos.put(video))
        await promisifyRequest(renders.put({ ...existing, ...render, videoRef: video.id }))
        return video.id
      })
    },

    async listRenders(sessionId, sceneId) {
      const renders = await readScenesOfScene<LocalRender>(sessionId, sceneId, LOCAL_STUDIO_RENDERS)
      return renders.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    },

    async putVideo(blob, mime) {
      const record: LocalVideoRecord = {
        id: `vid_${crypto.randomUUID()}`,
        blob,
        size: blob.size,
        mime: mime ?? blob.type,
        createdAt: new Date().toISOString(),
      }

      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_VIDEOS, 'readwrite', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_VIDEOS).put(record)),
      )
      return record.id
    },

    /** The caller owns the returned URL and must revoke it; this layer caches nothing. */
    async getVideoUrl(videoRef) {
      const handle = await db()
      const record: LocalVideoRecord | undefined = await runLocalTransaction(
        handle,
        LOCAL_STUDIO_VIDEOS,
        'readonly',
        (tx) => promisifyRequest(tx.objectStore(LOCAL_STUDIO_VIDEOS).get(videoRef)),
      )
      return record ? URL.createObjectURL(record.blob) : null
    },

    async deleteVideo(videoRef) {
      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_VIDEOS, 'readwrite', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_VIDEOS).delete(videoRef)),
      )
    },

    async putTrash(entry) {
      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_TRASH, 'readwrite', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_TRASH).put(entry)),
      )
    },

    async listTrash(sessionId, sceneId) {
      const entries = await readScenesOfScene<LocalTrashEntry>(sessionId, sceneId, LOCAL_STUDIO_TRASH)
      return entries.sort((left, right) => left.trashId - right.trashId)
    },

    async nextTrashId(sessionId, sceneId) {
      const entries = await readScenesOfScene<LocalTrashEntry>(sessionId, sceneId, LOCAL_STUDIO_TRASH)
      return nextLocalTrashId(entries.map((entry) => entry.trashId))
    },

    async deleteTrash(sessionId, sceneId, trashId) {
      const handle = await db()
      await runLocalTransaction(handle, LOCAL_STUDIO_TRASH, 'readwrite', (tx) =>
        promisifyRequest(tx.objectStore(LOCAL_STUDIO_TRASH).delete([sessionId, sceneId, trashId])),
      )
    },
  }
}
