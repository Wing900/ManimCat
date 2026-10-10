import type { CustomApiConfig } from '../../shared/types/api'
import type { ConnectionSettings } from './connection-types'
import { BYOK_PATTERN, CATKEY_PATTERN, getConnectionProviderConfig } from './connection-types'
import { loadConnection } from './connection-storage'

export function getConnectionHeaders(contentType?: string, connection = loadConnection(), credentialOverride?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (contentType) headers['Content-Type'] = contentType
  const credential = credentialOverride || (connection.activeMode === 'catkey' ? connection.catkey.key : connection.activeMode === 'byok' ? connection.byok.browserSecret : '')
  const mode = CATKEY_PATTERN.test(credential) ? 'catkey' : BYOK_PATTERN.test(credential) ? 'byok' : null
  if (mode) {
    headers.Authorization = `Bearer ${credential}`
    headers['X-ManimCat-Connection'] = mode
  }
  return headers
}

/** One serialization boundary for every request that invokes a model. */
export function withConnectionProvider<T extends { customApiConfig?: CustomApiConfig; providerConfig?: CustomApiConfig }>(
  input: T,
  connection: ConnectionSettings = loadConnection(),
): Omit<T, 'customApiConfig' | 'providerConfig'> & { providerConfig?: CustomApiConfig } {
  const { customApiConfig, providerConfig, ...body } = input
  const config = connection.activeMode === 'byok'
    ? providerConfig ?? customApiConfig ?? getConnectionProviderConfig(connection)
    : undefined
  return { ...body, ...(config ? { providerConfig: config } : {}) }
}
