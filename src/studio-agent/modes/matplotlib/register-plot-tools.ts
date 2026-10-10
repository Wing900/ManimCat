import type { StudioToolRegistry } from '../../tools/registry'
import type { StudioRenderDriver } from '../../render/studio-render-driver'
import { createPlotStudioRenderTool } from './tools/plot-render-tool'

export function registerPlotStudioTools(
  registry: StudioToolRegistry,
  driver: StudioRenderDriver
): void {
  registry.register(createPlotStudioRenderTool(driver))
}
