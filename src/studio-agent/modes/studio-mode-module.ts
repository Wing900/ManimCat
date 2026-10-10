import type { ApiCatalogPackage } from '../../services/api-rag'
import type { StudioRenderDriver } from '../render/studio-render-driver'
import type { StudioToolDefinition } from '../domain/types'
import { getStudioModeDefinition, type StudioModeDefinition } from './studio-mode'
import { createManimStudioRenderTool } from '../manim/tools/manim-render-tool'
import { createPlotStudioRenderTool } from '../plot/tools/plot-render-tool'

/** A lazily constructed Tool. The factory closes over whatever the Mode already holds. */
export type StudioToolFactory = () => StudioToolDefinition

/**
 * One Mode's complete product capability: its domain definition, its API catalog package,
 * its render driver and its Mode-specific Tools. The composition root passes a list of these
 * instead of wiring four separate mapping tables.
 */
export interface StudioModeModule {
  definition: StudioModeDefinition
  apiCatalogPackage: ApiCatalogPackage
  renderDriver: StudioRenderDriver
  tools: StudioToolFactory[]
}

export function createManimMode(driver: StudioRenderDriver): StudioModeModule {
  return {
    definition: getStudioModeDefinition('manim'),
    apiCatalogPackage: 'manim',
    renderDriver: driver,
    tools: [() => createManimStudioRenderTool(driver) as StudioToolDefinition]
  }
}

export function createMatplotlibMode(driver: StudioRenderDriver): StudioModeModule {
  return {
    definition: getStudioModeDefinition('matplotlib'),
    apiCatalogPackage: 'matplotlib',
    renderDriver: driver,
    tools: [() => createPlotStudioRenderTool(driver) as StudioToolDefinition]
  }
}