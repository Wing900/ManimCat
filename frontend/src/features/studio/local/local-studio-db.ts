/**
 * IndexedDB schema and a thin Promise wrapper for the Studio local store.
 *
 * No dependency: native IndexedDB plus the glue below. `local-studio-store.ts` is the only module
 * that talks to this file; nothing else should open the database.
 *
 * Key choice: Scenes are keyed by `[sessionId, id]`, so every Session may own its own `scene_1`.
 * Global uniqueness was the server-side store's constraint, and that store is going away.
 */

export const LOCAL_STUDIO_DB_NAME = 'manimcat-studio'
export const LOCAL_STUDIO_DB_VERSION = 1

export const LOCAL_STUDIO_SESSIONS = 'sessions'
export const LOCAL_STUDIO_SCENES = 'scenes'
export const LOCAL_STUDIO_MESSAGES = 'messages'
export const LOCAL_STUDIO_RENDERS = 'renders'
export const LOCAL_STUDIO_TRASH = 'trash'
export const LOCAL_STUDIO_VIDEOS = 'videos'
export const LOCAL_STUDIO_RUNS = 'runs'

/**
 * Creates every store the schema declares. Idempotent, so it can also serve a later version bump:
 * add a new `if (!contains(...))` block and raise `LOCAL_STUDIO_DB_VERSION`.
 */
export function upgradeLocalStudioDb(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(LOCAL_STUDIO_SESSIONS)) {
    const sessions = db.createObjectStore(LOCAL_STUDIO_SESSIONS, { keyPath: 'id' })
    sessions.createIndex('by-updatedAt', 'updatedAt')
  }

  if (!db.objectStoreNames.contains(LOCAL_STUDIO_SCENES)) {
    const scenes = db.createObjectStore(LOCAL_STUDIO_SCENES, { keyPath: ['sessionId', 'id'] })
    scenes.createIndex('by-session', 'sessionId')
  }

  if (!db.objectStoreNames.contains(LOCAL_STUDIO_MESSAGES)) {
    const messages = db.createObjectStore(LOCAL_STUDIO_MESSAGES, { keyPath: 'id' })
    // Non-unique [sessionId, sceneId] so one `IDBKeyRange.only` fetches a Scene's rows; ordering is
    // applied in memory because a Scene's row count is small.
    messages.createIndex('by-scene', ['sessionId', 'sceneId'])
    messages.createIndex('by-session', 'sessionId')
  }

  if (!db.objectStoreNames.contains(LOCAL_STUDIO_RENDERS)) {
    const renders = db.createObjectStore(LOCAL_STUDIO_RENDERS, { keyPath: ['sessionId', 'id'] })
    renders.createIndex('by-scene', ['sessionId', 'sceneId'])
  }

  if (!db.objectStoreNames.contains(LOCAL_STUDIO_TRASH)) {
    const trash = db.createObjectStore(LOCAL_STUDIO_TRASH, {
      keyPath: ['sessionId', 'sceneId', 'trashId'],
    })
    trash.createIndex('by-scene', ['sessionId', 'sceneId'])
  }

  // Video bodies live in their own store so one Blob can be referenced by both the current Scene and
  // its Recycle Bin entries, and deleted independently of them.
  if (!db.objectStoreNames.contains(LOCAL_STUDIO_VIDEOS)) {
    const videos = db.createObjectStore(LOCAL_STUDIO_VIDEOS, { keyPath: 'id' })
    videos.createIndex('by-createdAt', 'createdAt')
  }

  // Runs are written while active and treated as "not running" after a reload: liveness is the
  // server's business, and a stale "running" row would only fake a spinner.
  if (!db.objectStoreNames.contains(LOCAL_STUDIO_RUNS)) {
    db.createObjectStore(LOCAL_STUDIO_RUNS, { keyPath: ['sessionId', 'runId'] })
  }
}

export function openLocalStudioDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(LOCAL_STUDIO_DB_NAME, LOCAL_STUDIO_DB_VERSION)
    request.onupgradeneeded = () => upgradeLocalStudioDb(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the local Studio database'))
  })
}

export function deleteLocalStudioDb(factory: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(LOCAL_STUDIO_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Could not delete the local Studio database'))
  })
}

export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Local Studio request failed'))
  })
}

/**
 * Runs `body` inside one transaction and resolves once that transaction commits.
 *
 * Resolving on `oncomplete` (not when `body` resolves) is the point: a caller that awaits this knows
 * the write is durable, and a failing `body` aborts instead of committing half of its work.
 */
export function runLocalTransaction<T>(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const transaction = db.transaction(storeNames, mode)
  return new Promise<T>((resolve, reject) => {
    let result: T
    let bodyFailed = false

    transaction.oncomplete = () => {
      if (!bodyFailed) {
        resolve(result)
      }
    }
    transaction.onabort = () => reject(transaction.error ?? new Error('Local Studio transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Local Studio transaction failed'))

    Promise.resolve(body(transaction)).then(
      (value) => {
        result = value
      },
      (error: unknown) => {
        bodyFailed = true
        try {
          transaction.abort()
        } catch {
          // The transaction may already be finished; the rejection below is what matters.
        }
        reject(error)
      },
    )
  })
}
