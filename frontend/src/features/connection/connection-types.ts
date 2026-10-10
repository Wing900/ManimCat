import type { CustomApiConfig } from '../../shared/types/api'

export type ConnectionMode = 'catkey' | 'byok'

export interface ConnectionSettings {
  version: 1
  activeMode: ConnectionMode | null
  catkey: { key: string }
  byok: {
    browserSecret: string
    provider: 'openai-compatible' | 'google'
    apiUrl: string
    apiKey: string
    model: string
  }
}

export const CATKEY_PATTERN = /^mc_[0-9a-f]{64}$/
export const BYOK_PATTERN = /^byok_[0-9a-f]{64}$/
export const OPENAI_DEFAULT_URL = 'https://api.openai.com/v1'
export const GOOGLE_OPENAI_COMPAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'

export function createConnectionSettings(): ConnectionSettings {
  return {
    version: 1,
    activeMode: null,
    catkey: { key: '' },
    byok: { browserSecret: '', provider: 'openai-compatible', apiUrl: OPENAI_DEFAULT_URL, apiKey: '', model: '' },
  }
}

export function createBrowserSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `byok_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function getConnectionProviderConfig(connection: ConnectionSettings): CustomApiConfig | undefined {
  if (connection.activeMode !== 'byok') return undefined
  const { apiUrl, apiKey, model } = connection.byok
  if (!apiUrl.trim() || !apiKey.trim() || !model.trim()) return undefined
  return { apiUrl: apiUrl.trim(), apiKey: apiKey.trim(), model: model.trim() }
}

export function hasConnection(connection: ConnectionSettings): boolean {
  return connection.activeMode === 'catkey'
    ? CATKEY_PATTERN.test(connection.catkey.key)
    : connection.activeMode === 'byok' && BYOK_PATTERN.test(connection.byok.browserSecret) && Boolean(getConnectionProviderConfig(connection))
}
