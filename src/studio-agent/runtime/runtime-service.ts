import { createDefaultStudioPersistence } from '../persistence/create-default-studio-persistence'
import { createDefaultStudioBlobStore } from '../storage/create-default-studio-blob-store'
import { createLocalStudioWorkspaceProvider } from '../workspace/local-studio-workspace-provider'
import { createStudioRuntimeService } from './create-runtime-service'

const persistence = createDefaultStudioPersistence()
const workspaceProvider = createLocalStudioWorkspaceProvider()
const blobStore = createDefaultStudioBlobStore()

export const studioRuntime = createStudioRuntimeService({
  persistence,
  workspaceProvider,
  blobStore,
})
