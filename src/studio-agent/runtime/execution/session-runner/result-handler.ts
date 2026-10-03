import { InMemoryStudioEventBus } from '../../../events/event-bus'
import { extractLatestAssistantText, cancelRunState, failRunState, finalizeRunState } from '../session-runner-helpers'
import { selectStudioRunScopeRecords } from '../../../runs/message-selection'
import {
  STUDIO_RUN_ACTIVE_STATUSES,
  StudioRunFinalizationError
} from '../../../runs/run-status-transitions'
import type {
  StudioAssistantMessage,
  StudioEventBus,
  StudioRun,
  StudioSession
} from '../../../domain/types'
import type { StudioSessionRunnerDependencies } from './dependency-center'
import type { StudioRunExecutionResult } from '../../tools/tool-runtime-context'

export async function handleCancelledRun(
  deps: StudioSessionRunnerDependencies,
  input: {
    session: StudioSession
    run: StudioRun
    reason: string
  },
): Promise<never> {
  await applyTerminalRunState(deps, input.run, cancelRunState(input.run, input.reason))

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
): Promise<StudioRunExecutionResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
  const finishedRun = await applyTerminalRunState(
    deps,
    input.run,
    finalizeRunState({ run: input.run, outcome: input.outcome }),
    input.eventBus
  )

  const finalAssistantMessage = await findLatestAssistantMessage(
    deps,
    input.run,
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
  try {
    await applyTerminalRunState(deps, input.run, failRunState(input.run, message))
  } catch (transitionError) {
    // Error propagation rule for this path: the execution failure is what the operator must
    // see, so it stays the thrown error, with the finalization problem attached as its cause
    // when the error object allows it. Success and cancellation have no earlier error to
    // preserve, so they propagate the finalization failure itself.
    attachErrorCause(input.error, transitionError)
  }

  throw input.error
}

/** Best-effort `cause` attachment: a frozen error object is not worth failing over. */
function attachErrorCause(error: unknown, cause: unknown): void {
  if (!(error instanceof Error)) {
    return
  }
  try {
    Object.defineProperty(error, 'cause', { value: cause, configurable: true, writable: true })
  } catch {
    // Ignored by design: the original error is still thrown with its own message.
  }
}

/**
 * Single finalization path for success, failure and cancellation.
 *
 * The write is a conditional transition (`pending`/`running` -> terminal), so a Run cancelled
 * by another replica cannot be overwritten by a late `completed` or `failed` write from this
 * one. When the transition loses the race the persisted winner is what gets published, and
 * that winner is also what callers receive.
 *
 * A transition that yields no persisted Run at all (`{ applied: false, run: null }`) is a
 * persistence consistency failure: nothing was stored, so nothing may be published, and no
 * local candidate is ever returned as if it were terminal.
 */
async function applyTerminalRunState(
  deps: StudioSessionRunnerDependencies,
  run: StudioRun,
  next: StudioRun,
  eventBus?: StudioEventBus
): Promise<StudioRun> {
  const bus = eventBus ?? deps.sharedEventBus ?? new InMemoryStudioEventBus()
  const store = deps.runStore

  if (!store) {
    // No persistence in this configuration: the local state is the only state there is.
    bus.publish({ type: 'run_updated', sessionId: run.sessionId, run: next })
    return next
  }

  const result = await store.transitionStatus({
    ownerId: run.ownerId,
    runId: run.id,
    from: STUDIO_RUN_ACTIVE_STATUSES,
    patch: next
  })
  if (!result.run) {
    throw new StudioRunFinalizationError()
  }
  const persisted = result.run

  bus.publish({
    type: 'run_updated',
    sessionId: run.sessionId,
    run: persisted
  })

  return persisted
}

/**
 * Latest assistant message of the Run's own scope. With sibling Scene concurrency a Session-wide
 * lookup could return another Scene's message, so a Scene Run reads its Scene only and a Legacy
 * Run keeps the Session-wide behavior. The supplied fallback is preserved.
 */
async function findLatestAssistantMessage(
  deps: StudioSessionRunnerDependencies,
  run: StudioRun,
  fallback: StudioAssistantMessage,
): Promise<StudioAssistantMessage> {
  const messages = await selectStudioRunScopeRecords(run, {
    bySceneId: (sceneId) => deps.messageStore.listBySceneId(sceneId),
    bySessionId: () => deps.messageStore.listBySessionId(run.sessionId)
  })
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message): message is StudioAssistantMessage => message.role === 'assistant')

  return latestAssistantMessage ?? fallback
}
