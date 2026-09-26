import type { StudioKind } from '../domain/types'
import type {
  StudioStaticCheckAdapter,
  StudioStaticCheckPort,
  StudioStaticCheckRequest,
  StudioStaticCheckResult
} from './studio-static-check-types'

/**
 * Routes a static check by trusted Studio kind. Model or user input never names an
 * Adapter: the kind indexes the Adapter table, exactly like the Knowledge router.
 *
 * A missing Adapter is an explicit error. There is deliberately no fallback, so a Plot
 * request can never be served by Manim semantics (or the other way around).
 */
export class StudioStaticCheckRouter implements StudioStaticCheckPort {
  private readonly adapters: Partial<Record<StudioKind, StudioStaticCheckAdapter>>

  constructor(options: { adapters: Partial<Record<StudioKind, StudioStaticCheckAdapter>> }) {
    this.adapters = { ...options.adapters }
  }

  async check(request: StudioStaticCheckRequest): Promise<StudioStaticCheckResult> {
    const adapter = this.adapters[request.kind]
    if (!adapter) {
      throw new Error(`No Studio static check adapter is configured for kind: ${request.kind}`)
    }
    return adapter.check(request)
  }
}
