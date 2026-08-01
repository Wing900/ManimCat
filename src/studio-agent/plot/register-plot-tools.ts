import type { StudioToolRegistry } from '../tools/registry'
import type { PlotRenderPort } from './plot-render-port'
import { createPlotStudioRenderTool } from './tools/plot-render-tool'

export function registerPlotStudioTools(registry: StudioToolRegistry, renderPort?: PlotRenderPort): void {
  registry.register(createPlotStudioRenderTool(renderPort))
}
