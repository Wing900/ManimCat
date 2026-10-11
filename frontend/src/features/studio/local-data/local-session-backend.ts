import type { LocalStudioSessionRecord } from './local-session-record';

/**
 * 本地会话的存放处。做成一个可替换的后端，是因为两件事：
 *  1. 无痕窗口/禁用存储的浏览器里 IndexedDB 会直接抛错，那时降级到内存（本次会话可用，不崩）；
 *  2. jsdom 里没有 IndexedDB，规范因此可以用内存后端验证全部行为，不需要新增依赖。
 */
export interface LocalSessionBackend {
  readAll: () => Promise<LocalStudioSessionRecord[]>;
  write: (record: LocalStudioSessionRecord) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
}

export function createMemoryLocalSessionBackend(
  seed: LocalStudioSessionRecord[] = []
): LocalSessionBackend {
  const records = new Map<string, LocalStudioSessionRecord>(seed.map((record) => [record.id, record]));

  return {
    readAll: async () => Array.from(records.values()).map(cloneRecord),
    write: async (record) => {
      records.set(record.id, cloneRecord(record));
    },
    remove: async (sessionId) => {
      records.delete(sessionId);
    }
  };
}

const DATABASE_NAME = 'manimcat-studio-local';
const DATABASE_VERSION = 1;
const STORE_NAME = 'sessions';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = work(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * 真身落 IndexedDB：容量远大于 localStorage，而且不参与「同步读写」的性能陷阱。
 * 每次操作自己开一次连接——会话读写是低频动作，省下的复杂度比省下的毫秒值钱。
 */
export function createIndexedDbLocalSessionBackend(): LocalSessionBackend {
  return {
    readAll: async () => {
      const database = await openDatabase();
      try {
        return await runTransaction<LocalStudioSessionRecord[]>(
          database,
          'readonly',
          (store) => store.getAll() as IDBRequest<LocalStudioSessionRecord[]>
        );
      } finally {
        database.close();
      }
    },
    write: async (record) => {
      const database = await openDatabase();
      try {
        await runTransaction(database, 'readwrite', (store) => store.put(record));
      } finally {
        database.close();
      }
    },
    remove: async (sessionId) => {
      const database = await openDatabase();
      try {
        await runTransaction(database, 'readwrite', (store) => store.delete(sessionId));
      } finally {
        database.close();
      }
    }
  };
}

/**
 * 默认后端：能用 IndexedDB 就用它，不能就用内存。
 * 降级不是静默的失败：`degraded` 让上层能把「这次会话结束就没了」如实告诉用户。
 */
export function createDefaultLocalSessionBackend(): { backend: LocalSessionBackend; degraded: boolean } {
  if (typeof indexedDB === 'undefined') {
    return { backend: createMemoryLocalSessionBackend(), degraded: true };
  }

  try {
    return { backend: createIndexedDbLocalSessionBackend(), degraded: false };
  } catch {
    return { backend: createMemoryLocalSessionBackend(), degraded: true };
  }
}

function cloneRecord(record: LocalStudioSessionRecord): LocalStudioSessionRecord {
  return {
    ...record,
    scenes: record.scenes.map((scene) => ({ ...scene })),
    messages: record.messages.map((message) => ({ ...message }))
  };
}
