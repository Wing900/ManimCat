import type { StudioToolRegistry } from '../tools/registry'
import type { PlotRenderPort } from './plot-render-port'
import type { StudioStaticCheckPort } from '../static-check/studio-static-check-types'
import { createPlotStudioRenderTool } from './tools/plot-render-tool'

export function registerPlotStudioTools(
  registry: StudioToolRegistry,
  renderPort?: PlotRenderPort,
  staticCheckPort?: StudioStaticCheckPort
): void {
  registry.register(createPlotStudioRenderTool(renderPort, staticCheckPort))
}
