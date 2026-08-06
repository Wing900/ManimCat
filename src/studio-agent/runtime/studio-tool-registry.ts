import type { StudioToolRegistry } from '../tools/registry'
import { registerManimStudioTools } from '../manim/register-manim-tools'
import { createUnconfiguredManimRenderPort, type ManimRenderPort } from '../manim/manim-render-port'
import { registerPlotStudioTools } from '../plot/register-plot-tools'
import { createUnconfiguredPlotRenderPort, type PlotRenderPort } from '../plot/plot-render-port'
import { registerSharedStudioTools } from '../shared/register-shared-tools'

export function configureStudioToolRegistry(input: {
  registry: StudioToolRegistry
  manimRenderPort?: ManimRenderPort
  plotRenderPort?: PlotRenderPort
}): StudioToolRegistry {
  registerSharedStudioTools(input.registry)
  registerManimStudioTools(input.registry, input.manimRenderPort ?? createUnconfiguredManimRenderPort())
  registerPlotStudioTools(input.registry, input.plotRenderPort ?? createUnconfiguredPlotRenderPort())
  return input.registry
}
