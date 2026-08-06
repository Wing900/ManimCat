import type { StudioEventBus } from '../domain/types'
import { InMemoryStudioEventBus } from '../events/event-bus'
import { adaptStudioEvent, type StudioExternalEvent } from '../events/studio-event-adapter'
import type { StudioPersistence } from '../persistence/studio-persistence'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'
import type { StudioDocumentationContextProvider } from '../documentation/studio-documentation-context'
import { configureStudioToolRegistry } from './studio-tool-registry'
import { createStudioSessionService, type StudioSessionService } from './session-service'
import {
  createStudioRunService,
  type StudioRunService,
} from './run-service'

interface CreateStudioRuntimeServiceInput {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
  registry?: StudioToolRegistry
  eventBus?: StudioEventBus
  manimRenderPort?: import('../manim/manim-render-port').ManimRenderPort
  plotRenderPort?: import('../plot/plot-render-port').PlotRenderPort
  documentationProvider?: StudioDocumentationContextProvider
}

export interface StudioRuntimeService extends StudioSessionService, StudioRunService {
  subscribeExternalEvents: (sessionId: string, listener: (event: StudioExternalEvent) => void) => () => void
}

export function createStudioRuntimeService(input: CreateStudioRuntimeServiceInput): StudioRuntimeService {
  const registry = input.registry ?? new StudioToolRegistry()
  const eventBus: StudioEventBus = input.eventBus ?? new InMemoryStudioEventBus()
  configureStudioToolRegistry({
    registry,
    manimRenderPort: input.manimRenderPort,
    plotRenderPort: input.plotRenderPort,
  })
  const runtime = new StudioBuilderRuntime({
    registry,
    messageStore: input.persistence.messageStore,
    partStore: input.persistence.partStore,
    runStore: input.persistence.runStore,
    renderStore: input.persistence.renderStore,
    documentationProvider: input.documentationProvider,
    eventBus,
  })
  const sessionService = createStudioSessionService({
    persistence: input.persistence,
    workspaceProvider: input.workspaceProvider,
  })
  const runService = createStudioRunService({
    persistence: input.persistence,
    runtime,
    eventBus,
  })

  return {
    ...sessionService,
    ...runService,
    subscribeExternalEvents(sessionId: string, listener: (event: StudioExternalEvent) => void): () => void {
      return eventBus.subscribe(sessionId, (event) => {
        const adapted = adaptStudioEvent(event)
        if (adapted) {
          listener(adapted)
        }
      })
    },
  }
}
