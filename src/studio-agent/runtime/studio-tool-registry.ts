import type { ApiRagService } from '../../services/api-rag'
import type { StudioToolRegistry } from '../tools/registry'
import { registerManimStudioTools } from '../manim/register-manim-tools'
import { registerPlotStudioTools } from '../plot/register-plot-tools'
import { registerSharedStudioTools } from '../shared/register-shared-tools'
import type { StudioRenderDriverRegistry } from '../render/studio-render-driver'

/**
 * Every port is passed in. A missing port is a wiring error at construction, not a Tool that
 * fails the first time the model calls it.
 */
export function configureStudioToolRegistry(input: {
  registry: StudioToolRegistry
  driverRegistry: StudioRenderDriverRegistry
  apiRagService: ApiRagService
}): StudioToolRegistry {
  registerSharedStudioTools(input.registry, {
    apiRagService: input.apiRagService
  })
  const manimDriver = input.driverRegistry.resolve('manim')
  if (!manimDriver) {
    throw new Error('No render driver is registered for manim')
  }
  registerManimStudioTools(input.registry, manimDriver)
  const plotDriver = input.driverRegistry.resolve('matplotlib')
  if (!plotDriver) {
    throw new Error('No render driver is registered for matplotlib')
  }
  registerPlotStudioTools(input.registry, plotDriver)
  return input.registry
}
