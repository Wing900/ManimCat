import type { ApiRagService } from '../../services/api-rag'
import type { StudioToolRegistry } from '../tools/registry'
import { registerManimStudioTools } from '../manim/register-manim-tools'
import type { ManimRenderPort } from '../manim/manim-render-port'
import { registerPlotStudioTools } from '../plot/register-plot-tools'
import type { PlotRenderPort } from '../plot/plot-render-port'
import { registerSharedStudioTools } from '../shared/register-shared-tools'

/**
 * Every port is passed in. A missing port is a wiring error at construction, not a Tool that
 * fails the first time the model calls it.
 */
export function configureStudioToolRegistry(input: {
  registry: StudioToolRegistry
  manimRenderPort: ManimRenderPort
  plotRenderPort: PlotRenderPort
  apiRagService: ApiRagService
}): StudioToolRegistry {
  registerSharedStudioTools(input.registry, {
    apiRagService: input.apiRagService
  })
  registerManimStudioTools(input.registry, input.manimRenderPort)
  registerPlotStudioTools(input.registry, input.plotRenderPort)
  return input.registry
}
