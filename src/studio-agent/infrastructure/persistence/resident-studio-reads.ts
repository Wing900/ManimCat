import type { StudioPersistence } from './studio-persistence'

type Row = { id: string; ownerId?: string; sessionId?: string; sceneId?: string; messageId?: string; position?: number; createdAt?: string }
type Entry = { value?: unknown; pending?: Promise<unknown>; matches: (row: Row) => boolean; list: boolean; writes: Map<string, Row> }

/** Process-local read model. Session snapshots hydrate it; successful writes keep it current.
 * No timed expiration in the active conversation. Restarts/eviction reload from persistence.
 * Deployment must route a session's reads and execution to the same process.
 */
export function withResidentStudioReads(persistence: StudioPersistence): StudioPersistence {
  const scenes = new Map<string, Row>()
  const messages = new Map<string, Row>()
  const remember = (rows: Row[], index: Map<string, Row>) => {
    for (const row of rows) index.set(row.id, row)
    while (index.size > 4096) index.delete(index.keys().next().value!)
  }
  const caches: Array<{ clear: () => void }> = []
  function wrap<T extends object>(store: T, kind: string) {
    const entries = new Map<string, Entry>()
    const records = new Map<string, Row>()
    function publish(row: Row) {
      remember([structuredClone(row)], records)
      if (kind === 'scene') remember([row], scenes)
      if (kind === 'message') remember([row], messages)
      for (const entry of entries.values()) {
        if (entry.pending) entry.writes.set(row.id, structuredClone(row))
        if (entry.value !== undefined) entry.value = merge(entry, entry.value, [row])
      }
    }
    function sort(rows: Row[]): Row[] {
      if (kind === 'part') return rows
      return rows.sort((a, b) => kind === 'scene'
        ? (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id)
        : (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id))
    }
    function merge(entry: Entry, value: unknown, updates: Row[]): unknown {
      if (!entry.list) {
        const replacement = updates.find(entry.matches)
        return replacement ?? value
      }
      const rows = new Map((value as Row[]).map(row => [row.id, row]))
      for (const row of updates) {
        if (entry.matches(row)) rows.set(row.id, row)
        else rows.delete(row.id)
      }
      return sort([...rows.values()])
    }
    caches.push({ clear: () => { entries.clear(); records.clear() } })
    const proxy = new Proxy(store, {
      get(target, property) {
        const method = Reflect.get(target, property) as unknown
        if (typeof method !== 'function') return method
        const name = String(property)
        return async (...args: unknown[]) => {
          const invoke = () => Reflect.apply(method, target, args) as Promise<unknown>
          const read = name === 'getById' || name === 'listBySessionId' || name === 'listBySceneId' || name === 'listByMessageId'
          if (!read) {
            const result = await invoke()
            if (name === 'delete' && result) {
              for (const cache of caches) cache.clear()
              scenes.clear(); messages.clear()
            } else {
              const rows = Array.isArray(result) ? result : result && typeof result === 'object'
                ? [(result as { run?: Row; render?: Row }).run ?? (result as { render?: Row }).render ?? result] : []
              for (const row of rows) if (row && typeof row === 'object' && 'id' in row) publish(row as Row)
            }
            return result
          }
          const owner = args.length > 1 ? args[0] as string : undefined
          const id = args.at(-1) as string
          const matches = (row: Row) => (!owner || row.ownerId === owner) && (
            name === 'getById' ? row.id === id : name === 'listBySessionId' ? row.sessionId === id :
              name === 'listBySceneId' ? row.sceneId === id : row.messageId === id)
          const key = JSON.stringify([name, ...args])
          if (name === 'getById' && records.has(id) && matches(records.get(id)!)) return structuredClone(records.get(id))
          if (name === 'listByMessageId') {
            const message = messages.get(id) as (Row & { parts?: Row[] }) | undefined
            if (message?.parts) return structuredClone(message.parts)
          }
          let entry = entries.get(key)
          if (entry) {
            entries.delete(key); entries.set(key, entry)
            return structuredClone(await (entry.pending ?? Promise.resolve(entry.value)))
          }
          // A full session collection is also the authoritative source for scene slices and row reads.
          const sessionId = name === 'listBySceneId' ? scenes.get(id)?.sessionId : undefined
          for (const [sourceKey, source] of entries) {
            if (!source.list || source.value === undefined) continue
            const [sourceMethod, ...sourceArgs] = JSON.parse(sourceKey) as string[]
            if (name === 'listBySceneId' && sourceMethod === 'listBySessionId' && sourceArgs.at(-1) === sessionId && (!owner || sourceArgs[0] === owner)) {
              return structuredClone((source.value as Row[]).filter(matches))
            }
            if (name === 'getById') {
              const found = (source.value as Row[]).find(matches)
              if (found) return structuredClone(found)
            }
          }
          entry = { matches, list: name !== 'getById', writes: new Map() }
          entries.set(key, entry)
          while (entries.size > 256) entries.delete(entries.keys().next().value!)
          const current = entry
          current.pending = invoke().then(value => {
            current.value = merge(current, value, [...current.writes.values()])
            current.writes.clear()
            current.pending = undefined
            remember(current.list ? current.value as Row[] : current.value ? [current.value as Row] : [], records)
            if (kind === 'scene') remember(current.list ? current.value as Row[] : current.value ? [current.value as Row] : [], scenes)
            if (kind === 'message') remember(current.list ? current.value as Row[] : current.value ? [current.value as Row] : [], messages)
            return current.value
          }).catch(error => { if (entries.get(key) === current) entries.delete(key); throw error })
          return structuredClone(await current.pending)
        }
      },
    })
    return { store: proxy, publish }
  }
  const message = wrap(persistence.messageStore, 'message')
  const part = wrap(persistence.partStore, 'part')
  return {
    ...persistence,
    sessionStore: wrap(persistence.sessionStore, 'session').store,
    sceneStore: wrap(persistence.sceneStore, 'scene').store,
    messageStore: message.store,
    partStore: part.store,
    runStore: wrap(persistence.runStore, 'run').store,
    renderStore: wrap(persistence.renderStore, 'render').store,
    ...(persistence.conversationWriter ? { conversationWriter: async records => {
      await persistence.conversationWriter!(records)
      for (const row of records) {
        message.publish(row)
        if (row.role === 'assistant') for (const item of row.parts) part.publish(item)
      }
    } } : {}),
  }
}
