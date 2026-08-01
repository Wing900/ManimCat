import type { StudioToolDefinition } from '../domain/types'
import { createSharedStudioTools } from '../shared/register-shared-tools'
import { createStudioRenderTool } from './render-tool'
import type { ManimRenderPort } from '../manim/manim-render-port'

export function createPlaceholderStudioTools(renderPort?: ManimRenderPort): StudioToolDefinition[] {
  return [
    ...createSharedStudioTools(),
    createStudioRenderTool(renderPort) as StudioToolDefinition,
  ]
}
