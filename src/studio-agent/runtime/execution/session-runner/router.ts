import { resolveStudioToolChoice } from '../../session/session-agent-config'
import type { StudioAssistantMessage, StudioRun } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
  StudioRunRequestInput,
  StudioSessionRunnerDependencies
} from './dependency-center'
import { hasUsableCustomApiConfig } from './factory'
import { createAgentLoopExecution, createResolvedPlanExecution } from './execution-factories'
import { executePreparedStream } from './execution-manager'

export async function routePreparedRun(
  deps: StudioSessionRunnerDependencies,
  prepared: StudioPreparedRunContext,
  abortSignal: AbortSignal,
): Promise<{ run: StudioRun; assistantMessage: StudioAssistantMessage; text: string }> {
  if (hasUsableCustomApiConfig(prepared.input.customApiConfig)) {
    return executePreparedStream(deps, prepared, createAgentLoopExecution(deps, {
      prepared,
      customApiConfig: prepared.input.customApiConfig,
      toolChoice: resolveStudioToolChoice({ session: prepared.input.session, override: prepared.input.toolChoice }),
      abortSignal,
    }), abortSignal)
  }

  const plan = await deps.resolveTurnPlan({
    projectId: prepared.input.projectId,
    session: prepared.input.session,
    run: prepared.run,
    assistantMessage: prepared.assistantMessage,
    inputText: prepared.input.inputText,
    workContext: prepared.workContext
  })

  return executePreparedStream(deps, prepared, createResolvedPlanExecution(deps, {
    prepared,
    plan,
    customApiConfig: prepared.input.customApiConfig,
    toolChoice: prepared.input.toolChoice,
    abortSignal,
  }), abortSignal)
}
