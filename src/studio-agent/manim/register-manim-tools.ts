import type { StudioToolRegistry } from '../tools/registry'
import type { ManimRenderPort } from './manim-render-port'
import type { StudioStaticCheckPort } from '../static-check/studio-static-check-types'
import { createStudioRenderTool } from '../tools/render-tool'

export function registerManimStudioTools(
  registry: StudioToolRegistry,
  renderPort?: ManimRenderPort,
  staticCheckPort?: StudioStaticCheckPort
): void {
  registry.register(createStudioRenderTool(renderPort, staticCheckPort))
}
