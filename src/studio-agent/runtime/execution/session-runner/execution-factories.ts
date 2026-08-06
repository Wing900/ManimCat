import { createStudioOpenAIToolLoop } from '../../../orchestration/openai-tool-loop/controller'
import { readRunElapsedMs } from '../../../observability/plot-studio-timing'
import type { CustomApiConfig } from '../../../../types'
import type { StudioToolChoice } from '../../../domain/types'
import type { StudioPreparedRunContext, StudioPreparedRunExecution, StudioSessionRunnerDependencies } from './dependency-center'

export function createAgentLoopExecution(
  deps: StudioSessionRunnerDependencies,
  input: {
    prepared: StudioPreparedRunContext
    customApiConfig: CustomApiConfig
    toolChoice?: StudioToolChoice
    abortSignal: AbortSignal
  },
): StudioPreparedRunExecution {
  return {
    startLog: {
      event: 'loop.started',
      payload: {
        sessionId: input.prepared.input.session.id,
        runId: input.prepared.run.id,
        model: input.customApiConfig.model,
        toolChoice: input.toolChoice ?? null,
        runElapsedMs: readRunElapsedMs(input.prepared.run),
      }
    },
    events: createStudioOpenAIToolLoop({
      projectId: input.prepared.input.projectId,
      session: input.prepared.input.session,
      run: input.prepared.run,
      assistantMessage: input.prepared.assistantMessage,
      inputText: input.prepared.input.inputText,
      messageStore: deps.messageStore,
      registry: deps.registry,
      eventBus: input.prepared.eventBus,
      partStore: deps.partStore,
      sessionStore: deps.sessionStore,
      taskStore: deps.taskStore,
      workStore: deps.workStore,
      workResultStore: deps.workResultStore,
      workContext: input.prepared.workContext,
      createAssistantMessage: () => deps.createAssistantMessage(input.prepared.input.session, input.prepared.run.id),
      setToolMetadata: (assistantMessage, callId, metadata) => {
        void deps.processor.applyToolMetadata({
          assistantMessage,
          callId,
          title: metadata.title,
          metadata: metadata.metadata
        })
      },
      customApiConfig: input.customApiConfig,
      toolChoice: input.toolChoice,
      abortSignal: input.abortSignal,
      onCheckpoint: async (patch) => {
        const nextRun = deps.runStore
          ? await deps.runStore.update(input.prepared.run.ownerId, input.prepared.run.id, patch) ?? { ...input.prepared.run, ...patch }
          : { ...input.prepared.run, ...patch }
        input.prepared.run = nextRun
        input.prepared.eventBus.publish({
          type: 'run_updated',
          run: nextRun
        })
      }
    })
  }
}
