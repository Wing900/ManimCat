import { createStudioOpenAIToolLoop } from '../../../orchestration/openai-tool-loop/controller'
import { createStudioTurnExecutionStream } from '../tool-execution-stream'
import { readRunElapsedMs } from '../../../observability/plot-studio-timing'
import type { CustomApiConfig } from '../../../../types'
import type { StudioToolChoice, StudioRuntimeTurnPlan } from '../../../domain/types'
import type { StudioPreparedRunContext, StudioPreparedRunExecution, StudioSessionRunnerDependencies } from './dependency-center'

export function createResolvedPlanExecution(
  deps: StudioSessionRunnerDependencies,
  input: {
    prepared: StudioPreparedRunContext
    plan: StudioRuntimeTurnPlan
    customApiConfig?: CustomApiConfig
    toolChoice?: StudioToolChoice
    abortSignal: AbortSignal
  },
): StudioPreparedRunExecution {
  return {
    events: createStudioTurnExecutionStream({
      projectId: input.prepared.input.projectId,
      session: input.prepared.input.session,
      run: input.prepared.run,
      assistantMessage: input.prepared.assistantMessage,
      plan: input.plan,
      registry: deps.registry,
      eventBus: input.prepared.eventBus,
      sessionStore: deps.sessionStore,
      taskStore: deps.taskStore,
      workStore: deps.workStore,
      workResultStore: deps.workResultStore,
      runSubagent: (request) => deps.runSubagent({
        ...request,
        customApiConfig: input.customApiConfig,
        toolChoice: input.toolChoice
      }),
      resolveSkill: deps.resolveSkill,
      listSkills: deps.listSkills,
      listSkillSummaries: deps.listSkillSummaries,
      recordSkillUsage: deps.recordSkillUsage,
      setToolMetadata: (callId, metadata) => {
        void deps.processor.applyToolMetadata({
          assistantMessage: input.prepared.assistantMessage,
          callId,
          title: metadata.title,
          metadata: metadata.metadata
        })
      },
      customApiConfig: input.customApiConfig,
      abortSignal: input.abortSignal,
    })
  }
}

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
      sessionStore: deps.sessionStore,
      taskStore: deps.taskStore,
      workStore: deps.workStore,
      workResultStore: deps.workResultStore,
      workContext: input.prepared.workContext,
      runSubagent: (request) => deps.runSubagent({
        ...request,
        customApiConfig: input.customApiConfig,
        toolChoice: input.toolChoice
      }),
      resolveSkill: deps.resolveSkill,
      listSkills: deps.listSkills,
      listSkillSummaries: deps.listSkillSummaries,
      recordSkillUsage: deps.recordSkillUsage,
      createAssistantMessage: () => deps.createAssistantMessage(input.prepared.input.session),
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
          ? await deps.runStore.update(input.prepared.run.id, patch) ?? { ...input.prepared.run, ...patch }
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
