import type { StudioToolRegistry } from '../tools/registry'
import type { ManimRenderPort } from './manim-render-port'
import { createManimStudioRenderTool } from './tools/manim-render-tool'

export function registerManimStudioTools(
  registry: StudioToolRegistry,
  renderPort: ManimRenderPort
): void {
  registry.register(createManimStudioRenderTool(renderPort))
}
