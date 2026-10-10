import type { StudioToolRegistry } from '../../tools/registry'
import type { StudioRenderDriver } from '../../render/studio-render-driver'
import { createManimStudioRenderTool } from './tools/manim-render-tool'

export function registerManimStudioTools(
  registry: StudioToolRegistry,
  driver: StudioRenderDriver
): void {
  registry.register(createManimStudioRenderTool(driver))
}
