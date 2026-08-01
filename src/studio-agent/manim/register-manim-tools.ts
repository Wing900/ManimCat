import type { StudioToolRegistry } from '../tools/registry'
import type { ManimRenderPort } from './manim-render-port'
import { createStudioRenderTool } from '../tools/render-tool'

export function registerManimStudioTools(registry: StudioToolRegistry, renderPort?: ManimRenderPort): void {
  registry.register(createStudioRenderTool(renderPort))
}
