import type { StudioToolRegistry } from '../tools/registry'
import type { StudioKnowledgeProvider } from '../knowledge/studio-knowledge-types'
import type { StudioStaticCheckPort } from '../static-check/studio-static-check-types'
import { registerManimStudioTools } from '../manim/register-manim-tools'
import { createUnconfiguredManimRenderPort, type ManimRenderPort } from '../manim/manim-render-port'
import { registerPlotStudioTools } from '../plot/register-plot-tools'
import { createUnconfiguredPlotRenderPort, type PlotRenderPort } from '../plot/plot-render-port'
import { registerSharedStudioTools } from '../shared/register-shared-tools'

export function configureStudioToolRegistry(input: {
  registry: StudioToolRegistry
  manimRenderPort?: ManimRenderPort
  plotRenderPort?: PlotRenderPort
  knowledgeProvider?: StudioKnowledgeProvider
  staticCheckPort?: StudioStaticCheckPort
}): StudioToolRegistry {
  registerSharedStudioTools(input.registry, {
    knowledgeProvider: input.knowledgeProvider,
    staticCheckPort: input.staticCheckPort
  })
  registerManimStudioTools(input.registry, input.manimRenderPort ?? createUnconfiguredManimRenderPort())
  registerPlotStudioTools(input.registry, input.plotRenderPort ?? createUnconfiguredPlotRenderPort())
  return input.registry
}
