import { createDefaultStudioPersistence } from '../persistence/create-default-studio-persistence'
import { createLocalStudioWorkspaceProvider } from '../workspace/local-studio-workspace-provider'
import { createBullManimRenderPort } from '../manim/bull-manim-render-port'
import { createMatplotlibPlotRenderPort } from '../plot/matplotlib-plot-render-port'
import { createDefaultStudioKnowledgeProvider } from '../knowledge/create-default-studio-knowledge-provider'
import { createDefaultStudioStaticCheckPort } from '../static-check/create-default-studio-static-check-port'
import { createStudioRuntimeService } from './create-runtime-service'

const persistence = createDefaultStudioPersistence()
const workspaceProvider = createLocalStudioWorkspaceProvider()
// Built once so the Runtime Manim Catalog provider keeps its cache across tool calls.
const knowledgeProvider = createDefaultStudioKnowledgeProvider()
// Built once so no static check Adapter is constructed per tool call.
const staticCheckPort = createDefaultStudioStaticCheckPort()

export const studioRuntime = createStudioRuntimeService({
  persistence,
  workspaceProvider,
  manimRenderPort: createBullManimRenderPort(),
  plotRenderPort: createMatplotlibPlotRenderPort(),
  knowledgeProvider,
  staticCheckPort,
})
