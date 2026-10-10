import type { StudioAgentEvent, StudioEventBus, StudioRender } from '../domain/types'
import { InMemoryStudioEventBus } from '../infrastructure/events/event-bus'
import { adaptStudioEvent, type StudioExternalEvent } from '../infrastructure/events/studio-event-adapter'
import type { StudioPersistence } from '../infrastructure/persistence/studio-persistence'
import { StudioToolRegistry } from '../tools/registry'
import { StudioBuilderRuntime } from './builder-runtime'
import type { StudioWorkspaceProvider } from '../infrastructure/workspace/studio-workspace-provider'
import type { ApiRagService } from '../../services/api-rag'
import {
  createStudioRenderDriverRegistry,
  type StudioRenderDriverRegistry
} from '../render/studio-render-driver'
import type { StudioModeModule } from '../modes/studio-mode-module'
import {
  StudioRunCoordinationService,
  type StudioRunCoordinationServicePort
} from '../infrastructure/coordination/studio-run-coordination-service'
import { configureStudioToolRegistry } from './studio-tool-registry'
import { createStudioSessionService, type StudioSessionService } from './session-service'
import { createStudioSceneService, type StudioSceneService } from '../scenes/studio-scene-service'
import {
  createStudioRenderResultReconciler
} from '../render/render-result-reconciler'
import {
  createStudioRunService,
  type StudioRunService,
} from './run-service'

interface CreateStudioRuntimeServiceInput {
  persistence: StudioPersistence
  workspaceProvider: StudioWorkspaceProvider
  /** The single API RAG service, built at the composition root. */
  apiRagService: ApiRagService
  /** One Mode Module per Studio kind. The composition root builds these from concrete ports. */
  modes: readonly StudioModeModule[]
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

  // The driver registry is derived from the Mode Modules: the shared Run/Render layer
  // resolves a driver by kind without importing a concrete port.
  const driverRegistry: StudioRenderDriverRegistry = createStudioRenderDriverRegistry(
    input.modes.map((mode) => mode.renderDriver)
  )

  configureStudioToolRegistry({
    registry,
    modes: input.modes,
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
