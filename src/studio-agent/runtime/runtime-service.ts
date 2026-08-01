import { createDefaultStudioPersistence } from '../persistence/create-default-studio-persistence'
import { createDefaultStudioBlobStore } from '../storage/create-default-studio-blob-store'
import { createLocalStudioWorkspaceProvider } from '../workspace/local-studio-workspace-provider'
import { createBullManimRenderPort } from '../manim/bull-manim-render-port'
import { createMatplotlibPlotRenderPort } from '../plot/matplotlib-plot-render-port'
import { createJobStoreRenderJobPort } from '../render/job-store-render-job-port'
import { createStudioRuntimeService } from './create-runtime-service'

const persistence = createDefaultStudioPersistence()
const workspaceProvider = createLocalStudioWorkspaceProvider()
const blobStore = createDefaultStudioBlobStore()

export const studioRuntime = createStudioRuntimeService({
  persistence,
  workspaceProvider,
  blobStore,
  manimRenderPort: createBullManimRenderPort(),
  plotRenderPort: createMatplotlibPlotRenderPort(),
  renderJobPort: createJobStoreRenderJobPort(),
})
