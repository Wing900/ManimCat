import { InMemoryStudioEventBus } from '../../../events/event-bus'
import { createStudioUserMessage } from '../../../domain/factories'
import { logPlotStudioTiming, readElapsedMs } from '../../../observability/plot-studio-timing'
import { buildStudioRenderContext } from '../work-context'
import type { StudioRenderContext, StudioSession } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
  StudioRunRequestInput,
  StudioSessionRunnerDependencies
} from './dependency-center'
import { hasUsableCustomApiConfig } from './factory'
import { createEmptyStudioDocumentationContextProvider, loadStudioDocumentationContext } from '../../../documentation/studio-documentation-context'

export async function buildRenderContext(
  deps: Pick<StudioSessionRunnerDependencies, 'renderStore'>,
  input: { session: StudioSession },
): Promise<StudioRenderContext> {
  return buildStudioRenderContext({
    ownerId: input.session.ownerId,
    sessionId: input.session.id,
    agent: input.session.agentType,
    renderStore: deps.renderStore
  })
}

export async function prepareRun(
  deps: StudioSessionRunnerDependencies,
  input: StudioRunRequestInput,
): Promise<StudioPreparedRunContext> {
  const prepareStartedAt = Date.now()
  const renderContext = await deps.buildRenderContext({ session: input.session })
  const documentationContext = await loadStudioDocumentationContext(deps.documentationProvider ?? createEmptyStudioDocumentationContextProvider(), {
    kind: input.session.studioKind ?? 'manim',
    query: input.inputText,
    maxChars: 20_000,
  })
  const run = deps.createRun(input.session, input.inputText, input.runMetadata)
  const persistedRun = deps.runStore ? await deps.runStore.create(run) : run
  await deps.messageStore.createUserMessage(createStudioUserMessage({
    sessionId: input.session.id,
    text: input.inputText
  }))
  const assistantMessage = await deps.createAssistantMessage(input.session, persistedRun.id)
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
    renderContext,
    run: runningRun,
    assistantMessage,
    eventBus,
    documentationContext,
  }
}
