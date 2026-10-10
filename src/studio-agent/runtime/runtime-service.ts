import { createLogger } from '../../shared/logging/logger'
import { createDefaultStudioPersistence } from '../infrastructure/persistence/create-default-studio-persistence'
import { createLocalStudioWorkspaceProvider } from '../infrastructure/workspace/local-studio-workspace-provider'
import { createBullManimRenderPort } from '../modes/manim/bull-manim-render-port'
import { createJobStoreStudioRenderResultPort } from '../modes/manim/job-store-render-result-port'
import { createManimRenderDriver } from '../modes/manim/manim-render-driver'
import { createMatplotlibPlotRenderPort } from '../modes/matplotlib/matplotlib-plot-render-port'
import { createMatplotlibRenderDriver } from '../modes/matplotlib/plot-render-driver'
import { createManimMode, createMatplotlibMode } from '../modes/studio-mode-module'
import { getApiRagService } from '../../services/api-rag'
import { createDefaultStudioEventBus } from '../infrastructure/events/create-default-studio-event-bus'
import { createRedisStudioEventBroker } from '../infrastructure/events/redis-studio-event-broker'
import { createDefaultStudioRunCoordination } from '../infrastructure/coordination/create-default-studio-run-coordination'
import { createRedisStudioRunCoordinator } from '../infrastructure/coordination/redis-studio-run-coordinator'
import { createStudioInfrastructureRuntime } from '../infrastructure/coordination/studio-infrastructure-runtime'
import { createStudioRuntimeService } from './create-runtime-service'

const persistence = createDefaultStudioPersistence()
const workspaceProvider = createLocalStudioWorkspaceProvider()
// Built once so the Builder and Workflow Code Repair share one Baseline index, one
// SearchDoc matrix and one MiniLM session for the whole process.
const apiRagService = getApiRagService()

// Studio event delivery: distributed by default, so an SSE client on one replica receives
// events produced by a Run executing on another. The Redis broker factory is injected here
// in the composition root, which keeps `createDefaultStudioEventBus` (and every test that
// imports it) free of the shared Redis client. `createStudioRuntimeService` itself stays
// Redis-agnostic and injectable with any `StudioEventBus`.
export const studioEventRuntime = createDefaultStudioEventBus({
  createBroker: ({ channel }) => createRedisStudioEventBroker({ channel }),
})

// Studio Run coordination: session leases plus durable cancellation. Injected the same way, so
// the coordination modules stay free of the shared Redis client and remain injectable.
const studioRunCoordinationRuntime = createDefaultStudioRunCoordination({
  runStore: persistence.runStore,
  eventBus: studioEventRuntime.eventBus,
  createCoordinator: ({ prefix, controlChannel, leaseTtlMs, cancellationTtlMs }) =>
    createRedisStudioRunCoordinator({ prefix, controlChannel, leaseTtlMs, cancellationTtlMs }),
})

// One aggregate lifecycle for the infrastructure that must be up before HTTP and down after
// it. Order: start = event transport then Run coordination; close = Run coordination then the
// event transport (shutdown relinquishes Run ownership before delivery stops).
export const studioInfrastructureRuntime = createStudioInfrastructureRuntime({
  event: studioEventRuntime,
  runCoordination: studioRunCoordinationRuntime,
  logger: createLogger('StudioInfrastructure'),
})

export const studioRuntime = createStudioRuntimeService({
  persistence,
  workspaceProvider,
  modes: [
    createManimMode(
      createManimRenderDriver({
        renderPort: createBullManimRenderPort(),
        resultPort: createJobStoreStudioRenderResultPort(),
      })
    ),
    createMatplotlibMode(
      createMatplotlibRenderDriver({
        renderPort: createMatplotlibPlotRenderPort(),
      })
    ),
  ],
  apiRagService,
  eventBus: studioEventRuntime.eventBus,
  runCoordination: studioRunCoordinationRuntime.service,
})
