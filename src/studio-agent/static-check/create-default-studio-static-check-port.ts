import { ManimStaticCheckAdapter, type ManimStaticCheckRunner } from './manim-static-check-adapter'
import { MatplotlibStaticCheckAdapter, type MatplotlibStaticCheckRunner } from './matplotlib-static-check-adapter'
import { StudioStaticCheckRouter } from './studio-static-check-router'
import type { StudioStaticCheckPort } from './studio-static-check-types'

/**
 * Production composition: one Router with both Adapters over the shared Python engine.
 * Build it once at module scope (runtime/runtime-service.ts) so no Adapter is created per
 * Tool call. The runners are injection seams for tests only; production passes none.
 */
export function createDefaultStudioStaticCheckPort(input?: {
  manimRunner?: ManimStaticCheckRunner
  plotRunner?: MatplotlibStaticCheckRunner
}): StudioStaticCheckPort {
  return new StudioStaticCheckRouter({
    adapters: {
      manim: new ManimStaticCheckAdapter(input?.manimRunner),
      plot: new MatplotlibStaticCheckAdapter(input?.plotRunner)
    }
  })
}

/**
 * Explicitly unconfigured Port for isolated composition. It carries no Adapter, so a
 * check fails loudly instead of quietly borrowing another domain's semantics.
 */
export function createUnconfiguredStudioStaticCheckPort(): StudioStaticCheckPort {
  return new StudioStaticCheckRouter({ adapters: {} })
}
