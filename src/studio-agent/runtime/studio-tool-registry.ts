import type { ApiRagService } from '../../knowledge/api-rag'
import type { StudioToolRegistry } from '../tools/registry'
import { registerSharedStudioTools } from '../shared/register-shared-tools'
import type { StudioModeModule } from '../modes/studio-mode-module'

/**
 * Every Mode's Tools are registered from its Module. A missing Module is a wiring error
 * at construction, not a Tool that fails the first time the model calls it.
 */
export function configureStudioToolRegistry(input: {
  registry: StudioToolRegistry
  modes: readonly StudioModeModule[]
  apiRagService: ApiRagService
}): StudioToolRegistry {
  registerSharedStudioTools(input.registry, {
    apiRagService: input.apiRagService,
    modes: input.modes
  })
  for (const mode of input.modes) {
    for (const factory of mode.tools) {
      input.registry.register(factory())
    }
  }
  return input.registry
}
