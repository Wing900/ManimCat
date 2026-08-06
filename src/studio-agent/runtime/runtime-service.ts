import { createDefaultStudioPersistence } from '../persistence/create-default-studio-persistence'
import { createLocalStudioWorkspaceProvider } from '../workspace/local-studio-workspace-provider'
import { createBullManimRenderPort } from '../manim/bull-manim-render-port'
import { createMatplotlibPlotRenderPort } from '../plot/matplotlib-plot-render-port'
import { createStudioRuntimeService } from './create-runtime-service'

const persistence = createDefaultStudioPersistence()
const workspaceProvider = createLocalStudioWorkspaceProvider()

export const studioRuntime = createStudioRuntimeService({
  persistence,
  workspaceProvider,
  manimRenderPort: createBullManimRenderPort(),
  plotRenderPort: createMatplotlibPlotRenderPort(),
})
