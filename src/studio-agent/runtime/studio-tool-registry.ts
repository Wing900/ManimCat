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
    knowledgeProvider: input.knowledgeProvider
  })
  // The static check gate lives inside the render Tools: one Tool checks and renders, so no
  // standalone check Tool is registered and the port reaches the render path directly.
  registerManimStudioTools(
    input.registry,
    input.manimRenderPort ?? createUnconfiguredManimRenderPort(),
    input.staticCheckPort
  )
  registerPlotStudioTools(
    input.registry,
    input.plotRenderPort ?? createUnconfiguredPlotRenderPort(),
    input.staticCheckPort
  )
  return input.registry
}
