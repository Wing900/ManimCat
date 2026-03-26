import type { CustomApiConfig } from '../../types'

interface ResolveStudioEffectiveCustomApiConfigInput {
  requestCustomApiConfig?: CustomApiConfig
  routedCustomApiConfig?: CustomApiConfig
}

export interface StudioEffectiveCustomApiConfigResolution {
  effectiveCustomApiConfig?: CustomApiConfig
  routeByManimcatKey: boolean
  hasUsableCustomApiConfig: boolean
}

export function resolveStudioEffectiveCustomApiConfig(
  input: ResolveStudioEffectiveCustomApiConfigInput
): StudioEffectiveCustomApiConfigResolution {
  const effectiveCustomApiConfig = input.requestCustomApiConfig ?? input.routedCustomApiConfig

  return {
    effectiveCustomApiConfig,
    routeByManimcatKey: !input.requestCustomApiConfig && Boolean(input.routedCustomApiConfig),
    hasUsableCustomApiConfig: hasUsableCustomApiConfig(effectiveCustomApiConfig)
  }
}

function hasUsableCustomApiConfig(config?: CustomApiConfig): boolean {
  if (!config) {
    return false
  }

  return [config.apiUrl, config.apiKey, config.model].every((value) => typeof value === 'string' && value.trim().length > 0)
}
