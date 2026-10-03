import { InMemoryStudioEventBus } from '../../../events/event-bus'
import { createStudioUserMessage } from '../../../domain/factories'
import { logPlotStudioTiming, readElapsedMs } from '../../../observability/plot-studio-timing'
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
  // must fail closed before any render lookup, record or provider call. The scope is then used by
  // the render context, both initial messages and every Tool call of this Run.
  const executionScope = await loadStudioRunExecutionScope({
    session: input.session,
    sceneId: input.sceneId,
    sceneStore: deps.sceneStore,
  })
  const renderContext = await deps.buildRenderContext({ session: input.session, sceneId: input.sceneId })
  // One explicit scope for the Run and both initial messages: the scope is an argument here,
  // never a metadata convention, and every record is persisted before execution proceeds.
  const run = deps.createRun(input.session, input.inputText, input.runMetadata, input.sceneId)
  const persistedRun = deps.runStore ? await deps.runStore.create(run) : run
  const userMessage = await deps.messageStore.createUserMessage(createStudioUserMessage({
    sessionId: input.session.id,
    sceneId: input.sceneId,
    text: input.inputText
  }))
  // The assistant message is stamped strictly after the user message, so the two never tie on
  // `created_at` (a tie is broken by a random UUID id and renders the conversation out of order).
  const assistantMessage = await deps.createAssistantMessage(
    input.session,
    persistedRun.id,
    input.sceneId,
    userMessage.createdAt
  )
  const eventBus = deps.sharedEventBus ?? new InMemoryStudioEventBus()

  logPlotStudioTiming(input.session.studioKind, 'run.started', {
    sessionId: input.session.id,
    runId: persistedRun.id,
    assistantMessageId: assistantMessage.id,
    prepareDurationMs: readElapsedMs(prepareStartedAt),
    hasCustomApiConfig: hasUsableCustomApiConfig(input.customApiConfig),
  })

  const runningRun = deps.runStore
    ? await deps.runStore.update(input.session.ownerId, persistedRun.id, { status: 'running' }) ?? { ...persistedRun, status: 'running' }
    : { ...persistedRun, status: 'running' as const }

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
