import { InMemoryStudioEventBus } from '../../../events/event-bus'
import { extractLatestAssistantText, cancelRunState, failRunState, finalizeRunState } from '../session-runner-helpers'
import type {
  StudioAssistantMessage,
  StudioEventBus,
  StudioRun,
  StudioSession
} from '../../../domain/types'
import type { StudioSessionRunnerDependencies } from './dependency-center'
import type { StudioSubagentRunResult } from '../../tools/tool-runtime-context'

export async function handleCancelledRun(
  deps: StudioSessionRunnerDependencies,
  input: {
    session: StudioSession
    run: StudioRun
    reason: string
  },
): Promise<never> {
  const cancelledRun = cancelRunState(input.run, input.reason)
  await deps.runStore?.update(input.run.id, cancelledRun)
  ;(deps.sharedEventBus ?? new InMemoryStudioEventBus()).publish({
    type: 'run_updated',
    run: cancelledRun
  })

  throw new Error(input.reason)
}

export async function finalizeSuccessfulRun(
  deps: StudioSessionRunnerDependencies,
  input: {
    session: StudioSession
    run: StudioRun
    assistantMessage: StudioAssistantMessage
    outcome: 'continue' | 'stop' | 'compact'
    eventBus: StudioEventBus
  },
): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
  const finishedRun = finalizeRunState({ run: input.run, outcome: input.outcome })
  await deps.runStore?.update(input.run.id, finishedRun)
  input.eventBus.publish({
    type: 'run_updated',
    run: finishedRun
  })

  const finalAssistantMessage = await findLatestAssistantMessage(
    deps,
    input.session.id,
    input.assistantMessage,
  )

  return {
    run: finishedRun,
    assistantMessage: finalAssistantMessage,
    text: extractLatestAssistantText(finalAssistantMessage.parts)
  }
}

export async function handleFailedRun(
  deps: StudioSessionRunnerDependencies,
  input: {
    session: StudioSession
    run: StudioRun
    error: unknown
  },
): Promise<never> {
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const failedRun = failRunState(input.run, message)
  await deps.runStore?.update(input.run.id, failedRun)
  ;(deps.sharedEventBus ?? new InMemoryStudioEventBus()).publish({
    type: 'run_updated',
    run: failedRun
  })

  throw input.error
}

async function findLatestAssistantMessage(
  deps: StudioSessionRunnerDependencies,
  sessionId: string,
  fallback: StudioAssistantMessage,
): Promise<StudioAssistantMessage> {
  const messages = await deps.messageStore.listBySessionId(sessionId)
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message): message is StudioAssistantMessage => message.role === 'assistant')

  return latestAssistantMessage ?? fallback
}
