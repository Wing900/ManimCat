import { createDefaultStudioPersistence } from '../persistence/create-default-studio-persistence'
import { createLocalStudioWorkspaceProvider } from '../workspace/local-studio-workspace-provider'
import { createBullManimRenderPort } from '../manim/bull-manim-render-port'
import { createMatplotlibPlotRenderPort } from '../plot/matplotlib-plot-render-port'
import { createDefaultStudioKnowledgeProvider } from '../knowledge/create-default-studio-knowledge-provider'
import { createStudioRuntimeService } from './create-runtime-service'

const persistence = createDefaultStudioPersistence()
const workspaceProvider = createLocalStudioWorkspaceProvider()
// Built once so the Runtime Manim Catalog provider keeps its cache across tool calls.
const knowledgeProvider = createDefaultStudioKnowledgeProvider()

export const studioRuntime = createStudioRuntimeService({
  persistence,
  workspaceProvider,
  manimRenderPort: createBullManimRenderPort(),
  plotRenderPort: createMatplotlibPlotRenderPort(),
  knowledgeProvider,
})
