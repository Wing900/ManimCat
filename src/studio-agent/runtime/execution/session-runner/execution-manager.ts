import { logPlotStudioTiming } from '../../../observability/plot-studio-timing'
import { isStudioRunCancelledError, throwIfStudioRunCancelled } from '../run-cancellation'
import type { StudioAssistantMessage, StudioRun } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
  StudioPreparedRunExecution,
  StudioSessionRunnerDependencies
} from './dependency-center'
import type { StudioSubagentRunResult } from '../../tools/tool-runtime-context'
import { handleCancelledRun, handleFailedRun, finalizeSuccessfulRun } from './result-handler'

export async function executePreparedStream(
  deps: StudioSessionRunnerDependencies,
  prepared: StudioPreparedRunContext,
  execution: StudioPreparedRunExecution,
  abortSignal: AbortSignal,
): Promise<StudioSubagentRunResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
  try {
    throwIfStudioRunCancelled(abortSignal)
    if (execution.startLog) {
      logPlotStudioTiming(prepared.input.session.studioKind, execution.startLog.event, execution.startLog.payload)
    }

    const outcome = await deps.processor.processStream({
      session: prepared.input.session,
      run: prepared.run,
      assistantMessage: prepared.assistantMessage,
      eventBus: prepared.eventBus,
      events: execution.events
    })

    return finalizeSuccessfulRun(deps, {
      session: prepared.input.session,
      run: prepared.run,
      assistantMessage: prepared.assistantMessage,
      outcome,
      eventBus: prepared.eventBus
    })
  } catch (error) {
    if (isStudioRunCancelledError(error)) {
      return handleCancelledRun(deps, {
        session: prepared.input.session,
        run: prepared.run,
        reason: error.reason,
      })
    }
    return handleFailedRun(deps, {
      session: prepared.input.session,
      run: prepared.run,
      error
    })
  }
}
