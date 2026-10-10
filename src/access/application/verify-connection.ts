import type { CustomApiConfig } from '../../types'
import { requireProviderConfig, type AccessContext, type ConnectionMode } from '../domain/access-context'

export interface ConnectionProbe {
  (config: CustomApiConfig): Promise<{ model: string; content: string }>
}

export interface VerifyConnectionResult {
  readonly success: true
  readonly mode: ConnectionMode
  readonly model: string
  readonly content: string
  readonly duration: number
}

/**
 * One endpoint answers "does the connection I just configured actually reach a model?", for both
 * modes, because both modes end up holding a `CustomApiConfig` by the time they get here.
 */
export async function verifyConnection(
  accessContext: AccessContext,
  probe: ConnectionProbe,
  now: () => number = Date.now
): Promise<VerifyConnectionResult> {
  const startedAt = now()
  const providerConfig = requireProviderConfig(accessContext)
  const result = await probe(providerConfig)

  return {
    success: true,
    mode: accessContext.mode,
    model: result.model,
    content: result.content,
    duration: now() - startedAt
  }
}
