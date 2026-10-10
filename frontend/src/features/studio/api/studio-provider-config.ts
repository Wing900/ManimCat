import type { CustomApiConfig } from '../../../shared/types/api'
import { getConnectionProviderConfig, hasIncompleteByokProvider } from '../../connection/connection-types'
import { loadConnection } from '../../connection/connection-storage'

export class StudioProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudioProviderConfigError'
  }
}

export interface StudioProviderConfigResolution {
  /** `customApiConfig` from the request body. Honoured in BYOK mode only. */
  customApiConfig?: CustomApiConfig
  hasActiveProvider: boolean
  hasIncompleteProvider: boolean
}

/**
 * Resolves the one upstream a Studio Run will talk to, from the saved connection.
 *
 * CatKey mode sends nothing: the server picks the upstream and its config must never travel
 * through the browser. BYOK mode sends the browser's own provider config, which is the point of
 * the mode. Both branches keep the `customApiConfig` body name because the Studio Scene-run
 * parser is strict and accepts no other key.
 */
export function resolveStudioProviderConfig(): StudioProviderConfigResolution {
  const connection = loadConnection()

  if (connection.activeMode === 'catkey') {
    return { customApiConfig: undefined, hasActiveProvider: true, hasIncompleteProvider: false }
  }

  if (connection.activeMode === 'byok') {
    return {
      customApiConfig: getConnectionProviderConfig(connection),
      hasActiveProvider: true,
      hasIncompleteProvider: hasIncompleteByokProvider(connection),
    }
  }

  return { customApiConfig: undefined, hasActiveProvider: false, hasIncompleteProvider: false }
}

export function requireStudioProviderConfig(): CustomApiConfig | undefined {
  const resolution = resolveStudioProviderConfig()
  if (resolution.hasIncompleteProvider) {
    throw new StudioProviderConfigError(
      'Studio provider config is incomplete. Fill apiUrl, apiKey, and model, or clear the partial provider config.',
    )
  }
  return resolution.customApiConfig
}
