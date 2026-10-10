import type { CustomApiConfig } from '../../types'
import type { ConnectionMode } from '../../access'

interface ResolveStudioEffectiveCustomApiConfigInput {
  /** Which connection produced this request. CatKey requests may not be overridden by the browser. */
  mode: ConnectionMode
  /** `customApiConfig` from the request body. Honoured in BYOK mode only. */
  requestCustomApiConfig?: CustomApiConfig
  /** The config the AccessContext resolved: the server upstream in CatKey mode. */
  routedCustomApiConfig?: CustomApiConfig
}

export interface StudioEffectiveCustomApiConfigResolution {
  effectiveCustomApiConfig?: CustomApiConfig
  /** The config came from the server rather than from the browser. */
  routeByManimcatKey: boolean
  hasUsableCustomApiConfig: boolean
}

/**
 * Picks the one upstream a Studio Run will talk to.
 *
 * In CatKey mode the server's config wins and the request body is ignored outright — a CatKey
 * holder must not be able to point the maintainer's upstream anywhere else. In BYOK mode the
 * browser's own config is the point of the mode, so it takes precedence.
 */
export function resolveStudioEffectiveCustomApiConfig(
  input: ResolveStudioEffectiveCustomApiConfigInput
): StudioEffectiveCustomApiConfigResolution {
  const serverManaged = input.mode === 'catkey'
  const effectiveCustomApiConfig = serverManaged
    ? input.routedCustomApiConfig
    : input.requestCustomApiConfig ?? input.routedCustomApiConfig

  return {
    effectiveCustomApiConfig,
    routeByManimcatKey: serverManaged && Boolean(input.routedCustomApiConfig),
    hasUsableCustomApiConfig: hasUsableCustomApiConfig(effectiveCustomApiConfig)
  }
}

function hasUsableCustomApiConfig(config?: CustomApiConfig): boolean {
  if (!config) {
    return false
  }

  return [config.apiUrl, config.apiKey, config.model].every((value) => typeof value === 'string' && value.trim().length > 0)
}
