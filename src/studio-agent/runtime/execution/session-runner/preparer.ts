import { InMemoryStudioEventBus } from '../../../infrastructure/events/event-bus'
import { createStudioUserMessage } from '../../../domain/factories'
import { getStudioTelemetry, readElapsedMs } from '../../../infrastructure/telemetry/studio-telemetry'
import { buildStudioRenderContext } from '../render-context'
import { loadStudioRunExecutionScope } from '../run-execution-scope-loader'
import type { StudioRenderContext, StudioSession } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
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

export async function prepareRun(
  deps: StudioSessionRunnerDependencies,
  input: StudioRunRequestInput,
): Promise<StudioPreparedRunContext> {
  const prepareStartedAt = Date.now()
  // Scope first: a Scene Run whose Scene is missing, foreign or carries an unusable source path
  // must fail closed before any record or provider call. The scope is then used by both initial
  // messages and every Tool call of this Run.
  //
  // The render context is built from the same two arguments and never from the scope, so the two
  // reads leave together: one link round trip instead of two in a row.
  const [executionScope, renderContext] = await Promise.all([
    loadStudioRunExecutionScope({
      session: input.session,
      sceneId: input.sceneId,
      sceneStore: deps.sceneStore,
    }),
    deps.buildRenderContext({ session: input.session, sceneId: input.sceneId })
  ])
  // One explicit scope for the Run and both initial messages: the scope is an argument here, never a
  // metadata convention, and every record is persisted before execution proceeds.
  const run = deps.createRun(input.session, input.inputText, input.runMetadata, input.sceneId)
  // The user message carries no Run id, so it leaves with the Run insert instead of after it.
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
  // Marking the Run `running` needs nothing but the Run record, so that write leaves with it.
  const [assistantMessage, updatedRun] = await Promise.all([
    deps.createAssistantMessage(
      input.session,
      persistedRun.id,
      input.sceneId,
      userMessage.createdAt
    ),
    deps.runStore
      ? deps.runStore.update(input.session.ownerId, persistedRun.id, { status: 'running' })
      : Promise.resolve(null)
  ])
  const eventBus = deps.sharedEventBus ?? new InMemoryStudioEventBus()

  getStudioTelemetry().event({ studioKind: input.session.studioKind, name: 'run.started', data: {
    sessionId: input.session.id,
    runId: persistedRun.id,
    assistantMessageId: assistantMessage.id,
    prepareDurationMs: readElapsedMs(prepareStartedAt),
    hasCustomApiConfig: hasUsableCustomApiConfig(input.customApiConfig),
  } })

  const runningRun = updatedRun ?? { ...persistedRun, status: 'running' as const }

  eventBus.publish({
    type: 'run_updated',
    sessionId: input.session.id,
    run: runningRun
  })

  return {
    input,
    executionScope,
    renderContext,
    run: runningRun,
    assistantMessage,
    eventBus,
  }
}
