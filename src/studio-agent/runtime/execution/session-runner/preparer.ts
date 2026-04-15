import { InMemoryStudioEventBus } from '../../../events/event-bus'
import { createStudioUserMessage } from '../../../domain/factories'
import { logPlotStudioTiming, readElapsedMs } from '../../../observability/plot-studio-timing'
import { buildDraftAssistantMessage } from '../session-runner-helpers'
import { buildStudioWorkContext } from '../work-context'
import type { StudioSession, StudioWorkContext } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
  StudioRunRequestInput,
  StudioSessionRunnerDependencies
} from './dependency-center'
import { hasUsableCustomApiConfig } from './factory'

export async function buildWorkContext(
  deps: Pick<StudioSessionRunnerDependencies, 'workStore' | 'workResultStore' | 'taskStore' | 'sessionEventStore'>,
  input: {
    session: StudioSession
    inputText: string
  },
): Promise<StudioWorkContext> {
  const draftAssistantMessage = buildDraftAssistantMessage(input.session)
  const workContext = await buildStudioWorkContext({
    sessionId: input.session.id,
    agent: input.session.agentType,
    assistantMessage: draftAssistantMessage,
    workStore: deps.workStore,
    workResultStore: deps.workResultStore,
    taskStore: deps.taskStore,
    sessionEventStore: deps.sessionEventStore
  })

  return workContext ?? {
    sessionId: input.session.id,
    agent: input.session.agentType
  }
}

export async function prepareRun(
  deps: StudioSessionRunnerDependencies,
  input: StudioRunRequestInput,
): Promise<StudioPreparedRunContext> {
  const prepareStartedAt = Date.now()
  const workContext = await deps.buildWorkContext(input)
  const run = deps.createRun(input.session, input.inputText, input.runMetadata)
  const persistedRun = deps.runStore ? await deps.runStore.create(run) : run
  await deps.messageStore.createUserMessage(createStudioUserMessage({
    sessionId: input.session.id,
    text: input.inputText
  }))
  const assistantMessage = await deps.createAssistantMessage(input.session)
  const eventBus = deps.sharedEventBus ?? new InMemoryStudioEventBus()

  logPlotStudioTiming(input.session.studioKind, 'run.started', {
    sessionId: input.session.id,
    runId: persistedRun.id,
    assistantMessageId: assistantMessage.id,
    prepareDurationMs: readElapsedMs(prepareStartedAt),
    hasCustomApiConfig: hasUsableCustomApiConfig(input.customApiConfig),
  })

  const runningRun = deps.runStore
    ? await deps.runStore.update(persistedRun.id, { status: 'running' }) ?? { ...persistedRun, status: 'running' }
    : { ...persistedRun, status: 'running' as const }

  eventBus.publish({
    type: 'run_updated',
    run: runningRun
  })

  return {
    input,
    workContext,
    run: runningRun,
    assistantMessage,
    eventBus
  }
}
