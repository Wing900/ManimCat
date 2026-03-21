import type { CustomApiConfig } from '../../types/api'
import { getActiveProvider, providerToCustomApiConfig } from '../../lib/ai-providers'
import { loadSettings } from '../../lib/settings'

export class StudioProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudioProviderConfigError'
  }
}

export interface StudioProviderConfigResolution {
  customApiConfig?: CustomApiConfig
  hasActiveProvider: boolean
  hasIncompleteProvider: boolean
}

export function resolveStudioProviderConfig(): StudioProviderConfigResolution {
  const settings = loadSettings()
  const activeProvider = getActiveProvider(settings.api)
  const customApiConfig = providerToCustomApiConfig(activeProvider)

  if (!activeProvider) {
    return {
      customApiConfig: undefined,
      hasActiveProvider: false,
      hasIncompleteProvider: false,
    }
  }

  const hasAnyField = Boolean(
    activeProvider.apiUrl.trim() ||
      activeProvider.apiKey.trim() ||
      activeProvider.model.trim(),
  )

  return {
    customApiConfig,
    hasActiveProvider: true,
    hasIncompleteProvider: hasAnyField && !customApiConfig,
  }
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
