import { InMemoryStudioEventBus } from '../../../infrastructure/events/event-bus'
import { createStudioUserMessage } from '../../../domain/factories'
import { getStudioTelemetry, readElapsedMs } from '../../../infrastructure/telemetry/studio-telemetry'
import { buildStudioRenderContext } from '../render-context'
import { loadStudioRunExecutionScope } from '../run-execution-scope-loader'
import type { StudioRenderContext, StudioSession } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
  StudioAcceptedRunContext,
  StudioRunRequestInput,
  StudioSessionRunnerDependencies
} from './dependency-center'
import { hasUsableCustomApiConfig } from './factory'

export async function buildRenderContext(
  deps: Pick<StudioSessionRunnerDependencies, 'renderStore'>,
  input: { session: StudioSession; sceneId?: string },
): Promise<StudioRenderContext> {
  return buildStudioRenderContext({
    ownerId: input.session.ownerId,
    sessionId: input.session.id,
    sceneId: input.sceneId,
    agent: input.session.agentType,
    renderStore: deps.renderStore
  })
}

export async function acceptRun(
  deps: StudioSessionRunnerDependencies,
  input: StudioRunRequestInput,
): Promise<StudioAcceptedRunContext> {
  const acceptedAt = Date.now()
  // Task state is durable at admission; conversation records stay live until finalization.
  const run = { ...deps.createRun(input.session, input.inputText, input.runMetadata, input.sceneId), status: 'running' as const }
  // The scoped conversation buffer makes these message operations local.
  const [persistedRun, userMessage] = await Promise.all([
    deps.runStore ? deps.runStore.create(run) : Promise.resolve(run),
    deps.messageStore.createUserMessage(createStudioUserMessage({
      sessionId: input.session.id,
      sceneId: input.sceneId,
      text: input.inputText
    }))
  ])
  // The assistant message is stamped strictly after the user message, so the two never tie on
  // `created_at` (a tie is broken by a random UUID id and renders the conversation out of order).
  const assistantMessage = await deps.createAssistantMessage(
    input.session,
    persistedRun.id,
    input.sceneId,
    userMessage.createdAt
  )
  const eventBus = deps.sharedEventBus ?? new InMemoryStudioEventBus()

  const runningRun = persistedRun

  eventBus.publish({
    type: 'run_updated',
    sessionId: input.session.id,
    run: runningRun
  })
  getStudioTelemetry().event({ studioKind: input.session.studioKind, name: 'run.accepted', data: {
    sessionId: input.session.id,
    runId: runningRun.id,
    admissionDurationMs: readElapsedMs(acceptedAt),
  } })

  return {
    input,
    userMessage,
    run: runningRun,
    assistantMessage,
    eventBus,
  }
}

/** Scope validation stays mandatory before model/tool access, outside the submit critical path. */
export async function prepareRun(
  deps: StudioSessionRunnerDependencies,
  accepted: StudioAcceptedRunContext,
): Promise<StudioPreparedRunContext> {
  const prepareStartedAt = Date.now()
  const { input } = accepted
  const [executionScope, renderContext] = await Promise.all([
    loadStudioRunExecutionScope({ session: input.session, sceneId: input.sceneId, sceneStore: deps.sceneStore }),
    deps.buildRenderContext({ session: input.session, sceneId: input.sceneId }),
  ])
  getStudioTelemetry().event({ studioKind: input.session.studioKind, name: 'run.started', data: {
    sessionId: input.session.id,
    runId: accepted.run.id,
    assistantMessageId: accepted.assistantMessage.id,
    prepareDurationMs: readElapsedMs(prepareStartedAt),
    hasCustomApiConfig: hasUsableCustomApiConfig(input.customApiConfig),
  } })
  return { ...accepted, executionScope, renderContext }
}
