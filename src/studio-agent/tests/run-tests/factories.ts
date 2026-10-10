import { getDefaultStudioWorkspacePath } from '../../workspace/default-studio-workspace'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import {
  InMemoryStudioEventBus,
  InMemoryStudioMessageStore,
  InMemoryStudioPartStore,
  InMemoryStudioRunStore,
  InMemoryStudioSessionStore,
  StudioBuilderRuntime,
  StudioToolRegistry,
  type StudioAssistantMessage,
  type StudioRuntimeBackedToolContext
} from '../../index'
import type { StudioSession, StudioRun, StudioToolPart, StudioAssistantMessage as StudioAssistantMessageType } from '../../index'
import { createSharedStudioTools } from '../../shared/register-shared-tools'
import { ApiRagService } from '../../../services/api-rag/api-rag-service'
import {
  createStudioRuntimeService,
  createUnavailableStudioRenderResultPort,
  StudioRunCoordinationService,
  createInMemoryStudioRunCoordinator,
  type StudioEventBus,
  type StudioPersistence,
  type StudioRenderResultPort,
  type StudioRunCoordinationServicePort,
  type StudioRuntimeService,
  type StudioWorkspaceProvider,
  type ManimRenderPort,
  type PlotRenderPort
} from '../../index'

/** A RAG service that registers no package: no catalog file, no model, no tools. */
export function createDetachedApiRagService(): ApiRagService {
  return new ApiRagService({
    embedding: {
      dimensions: 384,
      embed: async (texts: readonly string[]) => texts.map(() => new Float32Array(384))
    },
    packages: []
  })
}

/**
 * Test-only runtime assembly. Production requires every port explicitly, so a test that wants a
 * fake names it here instead of receiving one from a hidden default inside the runtime.
 */
export function createTestStudioRuntime(options: {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
  eventBus?: StudioEventBus
  apiRagService?: ApiRagService
  manimRenderPort?: ManimRenderPort
  plotRenderPort?: PlotRenderPort
  renderResultPort?: StudioRenderResultPort
  runCoordination?: StudioRunCoordinationServicePort
}): StudioRuntimeService {
  const eventBus = options.eventBus ?? new InMemoryStudioEventBus()
  return createStudioRuntimeService({
    persistence: options.persistence,
    workspaceProvider: options.workspaceProvider,
    eventBus,
    apiRagService: options.apiRagService ?? createDetachedApiRagService(),
    manimRenderPort: options.manimRenderPort ?? { submit: async ({ jobId }) => ({ jobId }) },
    plotRenderPort: options.plotRenderPort ?? {
      execute: async () => ({
        outputDir: '',
        scriptPath: '',
        imageDataUris: [],
        imagePaths: [],
        stdout: '',
        stderr: ''
      })
    },
    renderResultPort: options.renderResultPort ?? createUnavailableStudioRenderResultPort(),
    runCoordination: options.runCoordination ?? new StudioRunCoordinationService({
      coordinator: createInMemoryStudioRunCoordinator(),
      runStore: options.persistence.runStore,
      eventBus
    })
  })
}

export function createTestRuntime(options?: {
  eventBus?: InMemoryStudioEventBus
}) {
  const registry = new StudioToolRegistry()
  for (const tool of createSharedStudioTools()) {
    registry.register(tool)
  }

  const messageStore = new InMemoryStudioMessageStore()
  const partStore = new InMemoryStudioPartStore()
  const runStore = new InMemoryStudioRunStore()
  const sessionStore = new InMemoryStudioSessionStore()

  const runtime = new StudioBuilderRuntime({
    registry,
    messageStore,
    partStore,
    runStore,
    eventBus: options?.eventBus
  })

  return {
    registry,
    runtime,
    messageStore,
    partStore,
    runStore,
    sessionStore
  }
}

export async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'manimcat-studio-agent-'))
}

export async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

export async function findLastAssistantMessageWithTool(messageStore: InMemoryStudioMessageStore, sessionId: string): Promise<StudioAssistantMessage | undefined> {
  const messages = await messageStore.listBySessionId(sessionId)
  return [...messages]
    .reverse()
    .find((message): message is StudioAssistantMessage => message.role === 'assistant' && message.parts.some((part) => part.type === 'tool'))
}
