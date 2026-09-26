import { createDefaultStudioPersistence } from '../persistence/create-default-studio-persistence'
import { createLocalStudioWorkspaceProvider } from '../workspace/local-studio-workspace-provider'
import { createBullManimRenderPort } from '../manim/bull-manim-render-port'
import { createMatplotlibPlotRenderPort } from '../plot/matplotlib-plot-render-port'
import { createDefaultStudioKnowledgeProvider } from '../knowledge/create-default-studio-knowledge-provider'
import { createDefaultStudioStaticCheckPort } from '../static-check/create-default-studio-static-check-port'
import { createDefaultStudioEventBus } from '../events/create-default-studio-event-bus'
import { createRedisStudioEventBroker } from '../events/redis-studio-event-broker'
import { createStudioRuntimeService } from './create-runtime-service'

const persistence = createDefaultStudioPersistence()
const workspaceProvider = createLocalStudioWorkspaceProvider()
// Built once so the Runtime Manim Catalog provider keeps its cache across tool calls.
const knowledgeProvider = createDefaultStudioKnowledgeProvider()
// Built once so no static check Adapter is constructed per tool call.
const staticCheckPort = createDefaultStudioStaticCheckPort()

// Studio event delivery: distributed by default, so an SSE client on one replica receives
// events produced by a Run executing on another. The Redis broker factory is injected here
// in the composition root, which keeps `createDefaultStudioEventBus` (and every test that
// imports it) free of the shared Redis client. `createStudioRuntimeService` itself stays
// Redis-agnostic and injectable with any `StudioEventBus`.
export const studioEventRuntime = createDefaultStudioEventBus({
  createBroker: ({ channel }) => createRedisStudioEventBroker({ channel }),
})

export const studioRuntime = createStudioRuntimeService({
  persistence,
  workspaceProvider,
  manimRenderPort: createBullManimRenderPort(),
  plotRenderPort: createMatplotlibPlotRenderPort(),
  knowledgeProvider,
  staticCheckPort,
  eventBus: studioEventRuntime.eventBus,
})
