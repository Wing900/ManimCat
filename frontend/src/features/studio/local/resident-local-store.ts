import type { LocalStudioStore } from './local-studio-store'
import type { StudioSceneMessage } from '../protocol/studio-agent-types'

// Shared by store instances in this tab, including the editor and the conversation ports.
const residents = new WeakMap<IDBFactory, Map<string, Promise<unknown>>>()

export function withResidentLocalReads(store: LocalStudioStore, factory: IDBFactory): LocalStudioStore {
  let cache = residents.get(factory)
  if (!cache) { cache = new Map(); residents.set(factory, cache) }
  const entries = cache
  const reads = new Set(['getSession', 'getScene', 'listScenes', 'listSessionMessages', 'listMessages'])
  const key = (name: string, args: unknown[]) => JSON.stringify([name, ...args])
  function forget(sessionId?: string, methods?: Set<string>) {
    for (const stored of entries.keys()) {
      const [method, id] = JSON.parse(stored) as string[]
      if ((!sessionId || id === sessionId) && (!methods || methods.has(method))) entries.delete(stored)
    }
  }
  return new Proxy(store, {
    get(target, property) {
      const method = Reflect.get(target, property) as unknown
      if (typeof method !== 'function') return method
      const name = String(property)
      return async (...args: unknown[]) => {
        const invoke = () => Reflect.apply(method, target, args) as Promise<unknown>
        if (reads.has(name)) {
          const stored = key(name, args)
          let pending = entries.get(stored)
          if (!pending) {
            const all = name === 'getScene' ? entries.get(key('listScenes', [args[0]])) :
              name === 'listMessages' ? entries.get(key('listSessionMessages', [args[0]])) : undefined
            pending = all ? all.then(rows => name === 'getScene'
              ? (rows as Array<{ id: string }>).find(row => row.id === args[1]) ?? null
              : (rows as StudioSceneMessage[]).filter(row => row.sceneId === args[1])) : invoke()
            entries.set(stored, pending)
            const loading = pending
            pending.catch(() => { if (entries.get(stored) === loading) entries.delete(stored) })
            while (entries.size > 512) entries.delete(entries.keys().next().value!)
          }
          return structuredClone(await pending)
        }
        if (name === 'appendMessage' || name === 'appendMessages') {
          const result = await invoke()
          const written = (name === 'appendMessage' ? [args[0]] : args[0]) as StudioSceneMessage[]
          for (const [stored, pending] of entries) {
            const [read, sessionId, sceneId] = JSON.parse(stored) as string[]
            if (read !== 'listSessionMessages' && read !== 'listMessages') continue
            const updates = written.filter(row => row.sessionId === sessionId && (read === 'listSessionMessages' || row.sceneId === sceneId))
            if (!updates.length) continue
            entries.set(stored, pending.then(value => {
              const rows = new Map((value as StudioSceneMessage[]).map(row => [row.id, row]))
              for (const row of updates) rows.set(row.id, structuredClone(row))
              return [...rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
            }))
          }
          return result
        }
        const mutates = new Set(['bindServerSession', 'deleteSession', 'createScene', 'updateSceneCode', 'reorderScenes', 'bindSceneServerId'])
        const affected = name === 'deleteSession' ? undefined : name === 'bindServerSession'
          ? new Set(['getSession']) : new Set(['getScene', 'listScenes'])
        if (mutates.has(name)) forget(args[0] as string, affected)
        const result = await invoke()
        if (mutates.has(name)) forget(args[0] as string, affected)
        if (name === 'close') forget()
        return result
      }
    },
  })
}
