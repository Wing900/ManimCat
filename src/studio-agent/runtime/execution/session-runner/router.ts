import { resolveStudioToolChoice } from '../../session-config'
import type { StudioAssistantMessage, StudioRun } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
  StudioPreparedRunExecution,
  StudioSessionRunnerDependencies
} from './dependency-center'
import { hasUsableCustomApiConfig } from './factory'
import { createAgentLoopExecution } from './execution-factories'
import { executePreparedStream } from './execution-manager'
import { handleCancelledRun, handleFailedRun } from './result-handler'
import { isStudioRunCancelledError } from '../run-cancellation'

export async function routePreparedRun(
  deps: StudioSessionRunnerDependencies,
  prepared: StudioPreparedRunContext,
  abortSignal: AbortSignal,
): Promise<{ run: StudioRun; assistantMessage: StudioAssistantMessage; text: string }> {
  let execution: StudioPreparedRunExecution
  try {
    execution = createExecution(deps, prepared, abortSignal)
  } catch (error) {
    // Nothing has streamed yet, but `prepareRun` already stored this Run as `running`. A failure
    // before the stream starts — the provider precondition below, or building the loop — would
    // otherwise leave that status behind forever, because the stream's own finalization never runs.
    // The transition is conditional on the Run still being active, so it cannot overwrite a state
    // another writer reached first; cancellation keeps its own path so a cancelled Run is never
    // reported as failed.
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
      error,
    })
  }

  return executePreparedStream(deps, prepared, execution, abortSignal)
}

/** Everything that must happen before a single token streams: the preconditions and the loop itself. */
function createExecution(
  deps: StudioSessionRunnerDependencies,
  prepared: StudioPreparedRunContext,
  abortSignal: AbortSignal,
): StudioPreparedRunExecution {
  const customApiConfig = prepared.input.customApiConfig
  if (!hasUsableCustomApiConfig(customApiConfig) && !prepared.input.modelPort) {
    throw new Error('Studio agent requires a usable customApiConfig (apiUrl, apiKey, model) to run the agent loop.')
  }

  return createAgentLoopExecution(deps, {
    prepared,
    customApiConfig,
    modelPort: prepared.input.modelPort,
    toolChoice: resolveStudioToolChoice({ session: prepared.input.session, override: prepared.input.toolChoice }),
    abortSignal,
  })
}
