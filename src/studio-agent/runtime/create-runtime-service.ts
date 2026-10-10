import type { StudioAgentEvent, StudioEventBus, StudioRender } from '../domain/types'
import { InMemoryStudioEventBus } from '../events/event-bus'
import { adaptStudioEvent, type StudioExternalEvent } from '../events/studio-event-adapter'
import type { StudioPersistence } from '../persistence/studio-persistence'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import type { StudioWorkspaceProvider } from '../workspace/studio-workspace-provider'
import type { ApiRagService } from '../../services/api-rag'
import type { ManimRenderPort } from '../manim/manim-render-port'
import type { PlotRenderPort } from '../plot/plot-render-port'
import { createManimRenderDriver } from '../manim/manim-render-driver'
import { createMatplotlibRenderDriver } from '../plot/plot-render-driver'
import {
  createStudioRenderDriverRegistry,
  type StudioRenderDriverRegistry
} from '../render/studio-render-driver'
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
import type { StudioRenderResultPort } from '../render/render-result-port'
import {
  createStudioRunService,
  type StudioRunService,
} from './run-service'

interface CreateStudioRuntimeServiceInput {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
  /** The single API RAG service, built at the composition root. */
  apiRagService: ApiRagService
  /** Where a Manim render is submitted. Production injects the job queue. */
  manimRenderPort: ManimRenderPort
  /** Where a plot render is executed. Production injects the sandboxed runner. */
  plotRenderPort: PlotRenderPort
  /** Render result source. Production injects the job store adapter. */
  renderResultPort: StudioRenderResultPort
  /** Run coordination (session leases + cancellation). Production injects the Redis service. */
  runCoordination: StudioRunCoordinationServicePort
  registry?: StudioToolRegistry
  eventBus?: StudioEventBus
}

export interface StudioRuntimeService extends StudioSessionService, StudioRunService, StudioSceneService {
  /**
   * Reads one Render by id. The media hand-off endpoint turns a Render into the file it delivers,
   * and this is the only reader that must see a Render outside its Session or Scene listing.
   */
  getRender: (ownerId: string, renderId: string) => Promise<StudioRender | null>
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

  // One driver per Mode wraps its Port; the registry is the only thing the shared layer imports.
  const driverRegistry: StudioRenderDriverRegistry = createStudioRenderDriverRegistry([
    createManimRenderDriver({ renderPort: input.manimRenderPort, resultPort: input.renderResultPort }),
    createMatplotlibRenderDriver({ renderPort: input.plotRenderPort }),
  ])

  configureStudioToolRegistry({
    registry,
    driverRegistry,
    apiRagService: input.apiRagService,
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
      driverRegistry,
      renderStore: input.persistence.renderStore,
      eventBus
    })
  })
  const runService = createStudioRunService({
    driverRegistry,
    persistence: input.persistence,
    runtime,
    eventBus,
    coordination: input.runCoordination,
  })

  return {
    ...sessionService,
    ...sceneService,
    ...runService,
    /**
     * Reads one Render by id. The media hand-off endpoint needs this to turn a Render into the file
     * it may deliver, and it is the only reader that must see a Render outside its Session listing.
     */
    getRender: (ownerId: string, renderId: string) => input.persistence.renderStore.getById(ownerId, renderId),
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
