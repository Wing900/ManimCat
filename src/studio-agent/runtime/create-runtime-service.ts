import type { StudioEventBus } from '../domain/types'
import { InMemoryStudioEventBus } from '../events/event-bus'
import { adaptStudioEvent, type StudioExternalEvent } from '../events/studio-event-adapter'
import type { StudioPersistence } from '../persistence/studio-persistence'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'
import type { StudioKnowledgeProvider } from '../knowledge/studio-knowledge-types'
import type { StudioStaticCheckPort } from '../static-check/studio-static-check-types'
import { createInMemoryStudioRunCoordinator } from '../run-coordination/in-memory-studio-run-coordinator'
import {
  StudioRunCoordinationService,
  type StudioRunCoordinationServicePort
} from '../run-coordination/studio-run-coordination-service'
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
  knowledgeProvider?: StudioKnowledgeProvider
  staticCheckPort?: StudioStaticCheckPort
  /**
   * Run coordination (session leases + cancellation). Defaults to an in-memory coordinator so
   * single-instance and test runtimes behave exactly as before; production injects the
   * Redis-backed service from the composition root.
   */
  runCoordination?: StudioRunCoordinationServicePort
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
    knowledgeProvider: input.knowledgeProvider,
    staticCheckPort: input.staticCheckPort,
  })
  const runtime = new StudioBuilderRuntime({
    registry,
    messageStore: input.persistence.messageStore,
    partStore: input.persistence.partStore,
    runStore: input.persistence.runStore,
    renderStore: input.persistence.renderStore,
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
    coordination: input.runCoordination ?? new StudioRunCoordinationService({
      coordinator: createInMemoryStudioRunCoordinator(),
      runStore: input.persistence.runStore,
      eventBus,
    }),
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
