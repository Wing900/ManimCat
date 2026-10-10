import type { ApiCatalogPackage, ApiRagService } from '../../services/api-rag'
import type { StudioKind, StudioToolDefinition } from '../domain/types'
import { createStudioEditTool } from '../tools/edit-tool'
import { createStudioGlobTool } from '../tools/glob-tool'
import { createStudioGrepTool } from '../tools/grep-tool'
import { createStudioLsTool } from '../tools/ls-tool'
import { createStudioReadTool } from '../tools/read-tool'
import { createStudioSearchApiTool } from '../tools/search-api-tool'
import { createStudioWriteTool } from '../tools/write-tool'
import type { StudioToolRegistry } from '../tools/registry'

/** A catalog package answers exactly one Studio kind. */
const PACKAGE_STUDIO_KINDS: Record<ApiCatalogPackage, StudioKind> = {
  manim: 'manim',
  matplotlib: 'plot'
}

/**
 * Named Tool dependencies. Positional arguments would grow fragile as more Tool
 * dependencies arrive, so every injectable dependency is passed by name.
 */
export interface SharedStudioToolDependencies {
  apiRagService?: ApiRagService
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

  // One search_api per package that has a Search Catalog. A package without one stays
  // invisible to the Builder instead of answering from a weaker query path.
  const apiRagService = dependencies?.apiRagService
  if (apiRagService) {
    for (const packageName of apiRagService.registeredPackages) {
      tools.push(
        createStudioSearchApiTool({
          service: apiRagService,
          packageName,
          studioKind: PACKAGE_STUDIO_KINDS[packageName]
        }) as StudioToolDefinition
      )
    }
  }

  return tools
}
