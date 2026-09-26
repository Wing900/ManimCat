import type { StudioToolDefinition } from '../domain/types'
import type { StudioKnowledgeProvider } from '../knowledge/studio-knowledge-types'
import type { StudioStaticCheckPort } from '../static-check/studio-static-check-types'
import { createStudioApplyPatchTool } from '../tools/apply-patch-tool'
import { createStudioEditTool } from '../tools/edit-tool'
import { createStudioGlobTool } from '../tools/glob-tool'
import { createStudioGrepTool } from '../tools/grep-tool'
import { createStudioLookupApiTool } from '../tools/lookup-api-tool'
import { createStudioLsTool } from '../tools/ls-tool'
import { createStudioReadTool } from '../tools/read-tool'
import { createStudioStaticCheckTool } from '../tools/static-check-tool'
import { createStudioWriteTool } from '../tools/write-tool'
import type { StudioToolRegistry } from '../tools/registry'

/**
 * Named Tool dependencies. Positional arguments would grow fragile as more Tool
 * dependencies arrive, so every injectable dependency is passed by name.
 */
export interface SharedStudioToolDependencies {
  knowledgeProvider?: StudioKnowledgeProvider
  staticCheckPort?: StudioStaticCheckPort
}

export function registerSharedStudioTools(
  registry: StudioToolRegistry,
  dependencies?: SharedStudioToolDependencies
): void {
  for (const tool of createSharedStudioTools(dependencies)) {
    registry.register(tool)
  }
}

export function createSharedStudioTools(
  dependencies?: SharedStudioToolDependencies
): StudioToolDefinition[] {
  return [
    createStudioReadTool() as StudioToolDefinition,
    createStudioGlobTool() as StudioToolDefinition,
    createStudioGrepTool() as StudioToolDefinition,
    createStudioLsTool() as StudioToolDefinition,
    createStudioWriteTool() as StudioToolDefinition,
    createStudioEditTool() as StudioToolDefinition,
    createStudioApplyPatchTool() as StudioToolDefinition,
    createStudioStaticCheckTool(dependencies?.staticCheckPort) as StudioToolDefinition,
    createStudioLookupApiTool(dependencies?.knowledgeProvider) as StudioToolDefinition,
  ]
}
