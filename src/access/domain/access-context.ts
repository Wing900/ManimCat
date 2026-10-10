import type { CustomApiConfig } from '../../types'
import { ValidationError } from '../../shared/errors/errors'

/**
 * The one thing every protected Route reads.
 *
 * A Route never learns which credential produced the context, never reads an environment array
 * and never queries Supabase: it reads `res.locals.accessContext` and takes the provider config
 * out of it.
 */

export type ConnectionMode = 'catkey' | 'byok'

export interface CatKeyAccessContext {
  readonly mode: 'catkey'
  readonly ownerId: string
  /** `cat_keys.id`. Survives the CatKey string itself, so usage rows keep pointing somewhere. */
  readonly catKeyId: string
  /** Always the server-side upstream. A request body can never override it. */
  readonly providerConfig: CustomApiConfig
}

export interface ByokAccessContext {
  readonly mode: 'byok'
  readonly ownerId: string
  /**
   * Present only on requests that reach an AI provider.
   *
   * Job status, cancel and Studio reads authenticate with the browser secret alone and carry no
   * provider config; they still need an owner, and nothing else. Routes that do call a model
   * take the config through `requireProviderConfig`, which fails loudly when it is missing
   * instead of sending a request to nowhere.
   */
  readonly providerConfig?: CustomApiConfig
}

export type AccessContext = CatKeyAccessContext | ByokAccessContext

export function isCatKeyMode(context: AccessContext): context is CatKeyAccessContext {
  return context.mode === 'catkey'
}

export function requireProviderConfig(context: AccessContext): CustomApiConfig {
  if (!context.providerConfig) {
    throw new ValidationError('自定义 API 配置不完整：需要 apiUrl、apiKey、model')
  }

  return context.providerConfig
}
