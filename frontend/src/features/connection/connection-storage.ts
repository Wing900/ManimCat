import { useSyncExternalStore } from 'react'
import { BYOK_PATTERN, CATKEY_PATTERN, REASONING_EFFORTS, createBrowserSecret, createConnectionSettings, hasConnection } from './connection-types'
import type { ConnectionSettings } from './connection-types'

export const CONNECTION_STORAGE_KEY = 'manimcat_connection'
const CONNECTION_CHANGED = 'manimcat:connection-changed'

function readConnection(raw: string): ConnectionSettings {
  const value = JSON.parse(raw) as ConnectionSettings
  if (value.version !== 1) return createConnectionSettings()
  const defaults = createConnectionSettings()
  const text = (value: unknown, fallback = '') => typeof value === 'string' ? value.trim() : fallback
  return {
    version: 1,
    activeMode: value.activeMode === 'catkey' || value.activeMode === 'byok' ? value.activeMode : null,
    dismissed: value.dismissed === true,
    reasoningEffort: REASONING_EFFORTS.includes(value.reasoningEffort!) ? value.reasoningEffort : 'high',
    catkey: { key: text(value.catkey?.key) },
    byok: {
      browserSecret: text(value.byok?.browserSecret),
      provider: value.byok?.provider === 'google' ? 'google' : 'openai-compatible',
      apiUrl: text(value.byok?.apiUrl, defaults.byok.apiUrl),
      apiKey: text(value.byok?.apiKey),
      model: text(value.byok?.model),
    },
  }
}

/** Migrate the single active legacy provider once, then remove legacy credential copies. */
export function loadConnection(): ConnectionSettings {
  const saved = localStorage.getItem(CONNECTION_STORAGE_KEY)
  if (saved) {
    try { return readConnection(saved) } catch { return createConnectionSettings() }
  }
  const connection = createConnectionSettings()
  try {
    const legacy = JSON.parse(localStorage.getItem('manimcat_settings') || '{}')
    const api = legacy.api
    const key = (api?.manimcatApiKey || localStorage.getItem('manimcat_api_key') || '').trim()
    if (CATKEY_PATTERN.test(key)) connection.catkey.key = key
    const provider = api?.providers?.find((item: { id: string }) => item.id === api.activeProviderId)
      ?? (api?.apiUrl ? api : undefined)
    if (provider) {
      connection.byok = {
        browserSecret: createBrowserSecret(),
        provider: provider.type === 'google' ? 'google' : 'openai-compatible',
        apiUrl: provider.apiUrl?.trim() || connection.byok.apiUrl,
        apiKey: provider.apiKey?.trim() || '',
        model: provider.model?.trim() || '',
      }
      connection.activeMode = 'byok'
    } else if (connection.catkey.key) connection.activeMode = 'catkey'
    if (!hasConnection(connection)) connection.activeMode = null
  connection.dismissed = false
    if (legacy.api) {
      delete legacy.api
      localStorage.setItem('manimcat_settings', JSON.stringify(legacy))
    }
  } catch { /* Invalid legacy settings have no usable connection. */ }
  localStorage.removeItem('manimcat_api_key')
  localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connection))
  return connection
}

export function saveConnection(connection: ConnectionSettings): void {
  const normalized = readConnection(JSON.stringify(connection))
  if (normalized.activeMode === 'byok' && !BYOK_PATTERN.test(normalized.byok.browserSecret)) {
    normalized.byok.browserSecret = createBrowserSecret()
  }
  localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new Event(CONNECTION_CHANGED))
}

/** 全清：连接方式、CatKey、BYOK 的 Key / 地址 / 模型一起回出厂；引导页随之复位。 */
export function clearConnection(): void {
  saveConnection(createConnectionSettings())
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONNECTION_STORAGE_KEY || event.key === null) listener()
  }
  window.addEventListener(CONNECTION_CHANGED, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CONNECTION_CHANGED, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useConnection(): ConnectionSettings {
  // The string snapshot remains referentially stable between writes.
  loadConnection()
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(CONNECTION_STORAGE_KEY) || '')
  return raw ? readConnection(raw) : createConnectionSettings()
}
