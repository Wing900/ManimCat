import type { StudioToolDefinition } from '../domain/types'
import type { StudioKnowledgeProvider } from '../knowledge/studio-knowledge-types'
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

export function registerSharedStudioTools(
  registry: StudioToolRegistry,
  knowledgeProvider?: StudioKnowledgeProvider
): void {
  for (const tool of createSharedStudioTools(knowledgeProvider)) {
    registry.register(tool)
  }
}

export function createSharedStudioTools(knowledgeProvider?: StudioKnowledgeProvider): StudioToolDefinition[] {
  return [
    createStudioReadTool() as StudioToolDefinition,
    createStudioGlobTool() as StudioToolDefinition,
    createStudioGrepTool() as StudioToolDefinition,
    createStudioLsTool() as StudioToolDefinition,
    createStudioWriteTool() as StudioToolDefinition,
    createStudioEditTool() as StudioToolDefinition,
    createStudioApplyPatchTool() as StudioToolDefinition,
    createStudioStaticCheckTool() as StudioToolDefinition,
    createStudioLookupApiTool(knowledgeProvider) as StudioToolDefinition,
  ]
}
