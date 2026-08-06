import { resolveStudioToolChoice } from '../../session-config'
import type { StudioAssistantMessage, StudioRun } from '../../../domain/types'
import type {
  StudioPreparedRunContext,
  StudioSessionRunnerDependencies
} from './dependency-center'
import { hasUsableCustomApiConfig } from './factory'
import { createAgentLoopExecution } from './execution-factories'
import { executePreparedStream } from './execution-manager'

export async function routePreparedRun(
  deps: StudioSessionRunnerDependencies,
  prepared: StudioPreparedRunContext,
  abortSignal: AbortSignal,
): Promise<{ run: StudioRun; assistantMessage: StudioAssistantMessage; text: string }> {
  const customApiConfig = prepared.input.customApiConfig
  if (!hasUsableCustomApiConfig(customApiConfig) && !prepared.input.modelPort) {
    throw new Error('Studio agent requires a usable customApiConfig (apiUrl, apiKey, model) to run the agent loop.')
  }

  return executePreparedStream(deps, prepared, createAgentLoopExecution(deps, {
    prepared,
    customApiConfig,
    modelPort: prepared.input.modelPort,
    toolChoice: resolveStudioToolChoice({ session: prepared.input.session, override: prepared.input.toolChoice }),
    abortSignal,
  }), abortSignal)
}
