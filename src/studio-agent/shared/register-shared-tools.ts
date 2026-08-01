import type { StudioToolDefinition } from '../domain/types'
import { createStudioApplyPatchTool } from '../tools/apply-patch-tool'
import { createStudioEditTool } from '../tools/edit-tool'
import { createStudioGlobTool } from '../tools/glob-tool'
import { createStudioGrepTool } from '../tools/grep-tool'
import { createStudioLsTool } from '../tools/ls-tool'
import { createStudioReadTool } from '../tools/read-tool'
import { createStudioStaticCheckTool } from '../tools/static-check-tool'
import { createStudioWriteTool } from '../tools/write-tool'
import type { StudioToolRegistry } from '../tools/registry'

export function registerSharedStudioTools(registry: StudioToolRegistry): void {
  for (const tool of createSharedStudioTools()) {
    registry.register(tool)
  }
}

export function createSharedStudioTools(): StudioToolDefinition[] {
  return [
    createStudioReadTool() as StudioToolDefinition,
    createStudioGlobTool() as StudioToolDefinition,
    createStudioGrepTool() as StudioToolDefinition,
    createStudioLsTool() as StudioToolDefinition,
    createStudioWriteTool() as StudioToolDefinition,
    createStudioEditTool() as StudioToolDefinition,
    createStudioApplyPatchTool() as StudioToolDefinition,
    createStudioStaticCheckTool() as StudioToolDefinition,
  ]
}
