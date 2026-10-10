import type { ApiRagService } from '../../knowledge/api-rag'
import type { StudioToolDefinition } from '../domain/types'
import { createStudioEditTool } from '../tools/edit-tool'
import { createStudioGlobTool } from '../tools/glob-tool'
import { createStudioGrepTool } from '../tools/grep-tool'
import { createStudioLsTool } from '../tools/ls-tool'
import { createStudioReadTool } from '../tools/read-tool'
import { createStudioSearchApiTool } from '../tools/search-api-tool'
import { createStudioWriteTool } from '../tools/write-tool'
import type { StudioToolRegistry } from '../tools/registry'
import type { StudioModeModule } from '../modes/studio-mode-module'

/**
 * Named Tool dependencies. Positional arguments would grow fragile as more Tool
 * dependencies arrive, so every injectable dependency is passed by name.
 */
export interface SharedStudioToolDependencies {
  apiRagService?: ApiRagService
  modes?: readonly StudioModeModule[]
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
  const tools: StudioToolDefinition[] = [
    createStudioReadTool() as StudioToolDefinition,
    createStudioGlobTool() as StudioToolDefinition,
    createStudioGrepTool() as StudioToolDefinition,
    createStudioLsTool() as StudioToolDefinition,
    createStudioWriteTool() as StudioToolDefinition,
    createStudioEditTool() as StudioToolDefinition
  ]

  // One search_api per Mode whose API catalog package is registered. A package without a
  // Search Catalog stays invisible to the Builder instead of answering from a weaker path.
  const apiRagService = dependencies?.apiRagService
  const modes = dependencies?.modes
  if (apiRagService && modes) {
    for (const mode of modes) {
      if (apiRagService.isRegistered(mode.apiCatalogPackage)) {
        tools.push(
          createStudioSearchApiTool({
            service: apiRagService,
            packageName: mode.apiCatalogPackage,
            studioKind: mode.definition.kind
          }) as StudioToolDefinition
        )
      }
    }
  }

  return tools
}
