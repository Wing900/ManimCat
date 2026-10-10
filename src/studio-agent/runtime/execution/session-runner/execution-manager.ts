import { getStudioTelemetry } from '../../../observability/studio-telemetry'
import { isStudioRunCancelledError, throwIfStudioRunCancelled } from '../run-cancellation'
import type { StudioAssistantMessage, StudioRun } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
  StudioPreparedRunExecution,
  StudioSessionRunnerDependencies
} from './dependency-center'
import type { StudioRunExecutionResult } from '../../tools/tool-runtime-context'
import { handleCancelledRun, handleFailedRun, finalizeSuccessfulRun } from './result-handler'

export async function executePreparedStream(
  deps: StudioSessionRunnerDependencies,
  prepared: StudioPreparedRunContext,
  execution: StudioPreparedRunExecution,
  abortSignal: AbortSignal,
): Promise<StudioRunExecutionResult & { run: StudioRun; assistantMessage: StudioAssistantMessage }> {
  try {
    throwIfStudioRunCancelled(abortSignal)
    if (execution.startLog) {
      getStudioTelemetry().event({ studioKind: prepared.input.session.studioKind, name: execution.startLog.event, data: execution.startLog.payload })
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
