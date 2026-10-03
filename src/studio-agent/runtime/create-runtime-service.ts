import type { StudioAgentEvent, StudioEventBus } from '../domain/types'
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
import { createStudioSceneService, type StudioSceneService } from '../scenes/studio-scene-service'
import {
  createStudioRenderResultReconciler
} from '../render/render-result-reconciler'
import {
  createUnavailableStudioRenderResultPort,
  type StudioRenderResultPort
} from '../render/render-result-port'
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
   * Render result source. Production injects the job store adapter at the composition root;
   * the default answers `unknown`, so an in-memory runtime never touches the queue.
   */
  renderResultPort?: StudioRenderResultPort
  /**
   * Run coordination (session leases + cancellation). Defaults to an in-memory coordinator so
   * single-instance and test runtimes behave exactly as before; production injects the
   * Redis-backed service from the composition root.
   */
  runCoordination?: StudioRunCoordinationServicePort
}

export interface StudioRuntimeService extends StudioSessionService, StudioRunService, StudioSceneService {
  /**
   * Session-keyed event delivery. `options.filter` runs on the domain event before adaptation, so
   * a Scene stream can drop sibling and Legacy events with the one canonical scope rule while the
   * Redis channel topology stays Session-keyed.
   */
  subscribeExternalEvents: (
    sessionId: string,
    listener: (event: StudioExternalEvent) => void,
    options?: { filter?: (event: StudioAgentEvent) => boolean }
  ) => () => void
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
    sceneStore: input.persistence.sceneStore,
    eventBus,
  })
  const sessionService = createStudioSessionService({
    persistence: input.persistence,
    workspaceProvider: input.workspaceProvider,
  })
  const sceneService = createStudioSceneService({
    persistence: input.persistence,
    workspaceProvider: input.workspaceProvider,
    renderResultReconciler: createStudioRenderResultReconciler({
      resultPort: input.renderResultPort ?? createUnavailableStudioRenderResultPort(),
      renderStore: input.persistence.renderStore,
      eventBus
    })
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
    ...sceneService,
    ...runService,
    subscribeExternalEvents(
      sessionId: string,
      listener: (event: StudioExternalEvent) => void,
      options?: { filter?: (event: StudioAgentEvent) => boolean }
    ): () => void {
      return eventBus.subscribe(sessionId, (event) => {
        if (options?.filter && !options.filter(event)) {
          return
        }

        const adapted = adaptStudioEvent(event)
        if (adapted) {
          listener(adapted)
        }
      })
    },
  }
}
