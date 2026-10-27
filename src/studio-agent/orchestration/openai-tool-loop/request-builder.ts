import type { StudioAssistantMessage } from '../../domain/types'
import { createStudioAssistantMessage } from '../../domain/factories'
import { createOpenAICompatibleStudioModelAdapter } from '../../model/studio-model-port'
import { getStudioTelemetry } from '../../infrastructure/telemetry/studio-telemetry'
import { readStudioRunAutonomyMetadata } from '../../runs/autonomy-policy'
import { listStudioMessagesForRun } from '../../runs/message-selection'
import type { StudioTokenUsageTracker } from '../../runs/studio-token-usage-tracker'
import { buildStudioAgentSystemPrompt } from '../studio-agent-prompt'
import {
  buildStudioConversationMessagesWithSources,
} from '../studio-message-history'
import { persistProviderMessageSnapshot } from '../studio-provider-message'
import { buildStudioChatTools } from '../studio-tool-schema'
import {
  buildStudioCompactionSummaryPrompt,
  buildStudioSummaryConversationMessage,
  selectStudioCompactionPlan,
  selectStudioStoredConversation,
  StudioContextWindowError,
  type StudioCompactionMetadata,
} from '../../context/compaction'
import {
  estimateStudioContextTokens,
  readStudioContextConfig,
  readStudioContextLimit,
} from '../../context/context-budget'
import { normalizeStudioAssistantText } from './message-assembly'
import { logStudioLoopStepResponse, logStudioLoopStepStarted } from './observability'
import type {
  StudioChatCompletionMessage,
  StudioLoopRuntime,
  StudioLoopStepRequest,
  StudioLoopStepResult,
  StudioOpenAIToolLoopInput
} from './types'

const DEFAULT_MAX_STEPS = 8

export async function createStudioLoopRuntime(input: StudioOpenAIToolLoopInput): Promise<StudioLoopRuntime> {
  const model = input.customApiConfig?.model?.trim() || 'studio-scripted'
  if (!input.modelPort && !input.customApiConfig) {
    throw new Error('Studio agent requires a provider model')
  }

  const tools = buildStudioChatTools(input.registry, input.session.agentType, input.session.studioKind)
  // Scope-selected conversation: this is the only conversation read in the model request path,
  // so a Scene Run can never see a sibling or Legacy history.
  const storedMessages = await listStudioMessagesForRun({
    messageStore: input.messageStore,
    run: input.run
  })
  const storedConversation = selectStudioStoredConversation(storedMessages)
  const built = buildStudioConversationMessagesWithSources({ messages: storedConversation.messages })
  const summaryMessages = storedConversation.summary
    ? [buildStudioSummaryConversationMessage(storedConversation.summary)]
    : []

  return {
    modelPort: input.modelPort ?? createOpenAICompatibleStudioModelAdapter(input.customApiConfig!),
    model,
    tools,
    conversation: [...summaryMessages, ...built.messages],
    conversationSourceMessageIds: [...summaryMessages.map(() => undefined), ...built.sourceMessageIds],
    contextConfig: readStudioContextConfig(),
    contextTokenRatio: 1,
    contextEstimatedTokens: 0,
    compactionSummary: storedConversation.summary,
    systemPrompt: buildStudioAgentSystemPrompt({
      session: input.session,
      renderContext: input.renderContext,
      executionScope: input.executionScope
    }),
    maxSteps: input.maxSteps ?? readStudioRunAutonomyMetadata(input.run.metadata).maxSteps ?? DEFAULT_MAX_STEPS,
    toolChoice: input.toolChoice ?? 'auto',
    currentAssistantMessage: input.assistantMessage
  }
}

export function buildStudioLoopStepRequest(runtime: StudioLoopRuntime): StudioLoopStepRequest {
  const messages = [
    { role: 'system' as const, content: runtime.systemPrompt },
    ...runtime.conversation
  ]
  const estimatedTokens = estimateStudioContextTokens({
    systemPrompt: runtime.systemPrompt,
    messages: runtime.conversation,
    tools: runtime.tools,
    ratio: runtime.contextTokenRatio,
  })
  runtime.contextEstimatedTokens = estimatedTokens

  return {
    messages,
    requestMessageCharsApprox: JSON.stringify(messages).length,
    requestToolSchemaCharsApprox: JSON.stringify(runtime.tools).length,
    estimatedTokens,
  }
}

/**
 * Compacts before a model step when the calibrated estimate exceeds `window - reserve`.
 * A forced call is the one-and-only retry after a provider context overflow.
 */
export async function compactStudioLoopContext(input: {
  loopInput: StudioOpenAIToolLoopInput
  runtime: StudioLoopRuntime
  step: number
  force: boolean
  usageTracker: StudioTokenUsageTracker
}): Promise<boolean> {
  const config = input.runtime.contextConfig
  if (!config.enabled && !input.force) {
    return false
  }

  const estimatedTokens = estimateStudioContextTokens({
    systemPrompt: input.runtime.systemPrompt,
    messages: input.runtime.conversation,
    tools: input.runtime.tools,
    ratio: input.runtime.contextTokenRatio,
  })
  input.runtime.contextEstimatedTokens = estimatedTokens
  const limit = readStudioContextLimit(config)
  if (!input.force && estimatedTokens <= limit) {
    return false
  }

  const plan = selectStudioCompactionPlan({
    conversation: input.runtime.conversation,
    sourceMessageIds: input.runtime.conversationSourceMessageIds,
    keepRecentTokens: config.keepRecentTokens,
    contextLimitTokens: limit,
  })
  const summary = await generateStudioCompactionSummary({
    loopInput: input.loopInput,
    runtime: input.runtime,
    prefixMessages: plan.prefixMessages,
    step: input.step,
    usageTracker: input.usageTracker,
  })
  const metadata: StudioCompactionMetadata = {
    firstKeptMessageId: plan.firstKeptMessageId,
    tokensBefore: estimatedTokens,
    model: input.runtime.model,
  }
  const existingRecord = input.runtime.compactionRecord?.assistantMessageId === input.runtime.currentAssistantMessage.id
    ? input.runtime.compactionRecord
    : undefined
  if (existingRecord) {
    await input.loopInput.messageStore.updateAssistantMessage(existingRecord.messageId, {
      summary,
      metadata: { compaction: metadata },
    })
  } else {
    const record = createStudioAssistantMessage({
      sessionId: input.loopInput.session.id,
      sceneId: input.loopInput.run.sceneId,
      agent: input.loopInput.session.agentType,
      metadata: { compaction: metadata },
    })
    // The record is control data, not this step's reply. Timestamp it just before the current
    // assistant message so Run finalization still finds the assistant message the user saw.
    const recordTimestamp = justBefore(input.runtime.currentAssistantMessage.createdAt)
    record.createdAt = recordTimestamp
    record.updatedAt = recordTimestamp
    record.summary = summary
    await input.loopInput.messageStore.createAssistantMessage(record)
    input.runtime.compactionRecord = {
      messageId: record.id,
      assistantMessageId: input.runtime.currentAssistantMessage.id,
    }
  }

  const summaryMessage = buildStudioSummaryConversationMessage(summary)
  input.runtime.compactionSummary = summary
  input.runtime.conversation = [summaryMessage, ...plan.keptMessages]
  input.runtime.conversationSourceMessageIds = [undefined, ...plan.keptSourceMessageIds]
  input.runtime.contextEstimatedTokens = estimateStudioContextTokens({
    systemPrompt: input.runtime.systemPrompt,
    messages: input.runtime.conversation,
    tools: input.runtime.tools,
    ratio: input.runtime.contextTokenRatio,
  })
  if (input.runtime.contextEstimatedTokens > limit) {
    throw new StudioContextWindowError(
      `Studio context is still over budget after compaction (${input.runtime.contextEstimatedTokens} > ${limit} estimated tokens).`
    )
  }
  getStudioTelemetry().timeline({
    studioKind: input.loopInput.session.studioKind,
    name: 'context.compacted',
    detail: `${estimatedTokens} -> ${input.runtime.contextEstimatedTokens} tokens; boundary ${plan.firstKeptMessageId}`,
  })
  return true
}

async function generateStudioCompactionSummary(input: {
  loopInput: StudioOpenAIToolLoopInput
  runtime: StudioLoopRuntime
  prefixMessages: StudioLoopStepRequest['messages']
  step: number
  usageTracker: StudioTokenUsageTracker
}): Promise<string> {
  const messages = buildStudioCompactionSummaryPrompt({
    previousSummary: input.runtime.compactionSummary,
    messages: input.prefixMessages,
  })
  // Direct model call: summary generation never enters the Tool Loop, so it cannot recurse.
  // It still crosses the same Run usage tracker, so the extra provider call is billed/checkpointed.
  const completion = await input.usageTracker.trackProviderCall({
    invoke: () => input.runtime.modelPort.complete({
      model: input.runtime.model,
      messages,
      tools: [],
      toolChoice: 'none',
      sessionId: input.loopInput.session.id,
      runId: input.loopInput.run.id,
      step: input.step + 1,
      assistantMessageId: input.runtime.currentAssistantMessage.id,
      studioKind: input.loopInput.session.studioKind,
      runCreatedAt: input.loopInput.run.createdAt,
      requestMessageCount: messages.length,
      requestMessageCharsApprox: JSON.stringify(messages).length,
      requestToolSchemaCharsApprox: 0,
      signal: input.loopInput.abortSignal,
    }),
    readUsage: (response) => response.usage
  })
  const summary = normalizeStudioAssistantText(completion.choices[0]?.message?.content)
  if (!summary) {
    throw new Error('Studio context compaction produced an empty summary.')
  }
  return summary
}

export async function requestStudioLoopStep(input: {
  loopInput: StudioOpenAIToolLoopInput
  runtime: StudioLoopRuntime
  request: StudioLoopStepRequest
  step: number
  stepStartedAt: number
  usageTracker: StudioTokenUsageTracker
}): Promise<StudioLoopStepResult> {
  logStudioLoopStepStarted({
    loopInput: input.loopInput,
    conversationLength: input.runtime.conversation.length,
    toolCount: input.runtime.tools.length,
    request: input.request,
    step: input.step
  })
  getStudioTelemetry().timeline({ studioKind: input.loopInput.session.studioKind, name: 'step.started', detail: `step ${input.step + 1}, ${input.runtime.conversation.length} msgs` })

  // One provider invocation, one usage increment, checkpointed before the loop continues.
  const completion = await input.usageTracker.trackProviderCall({
    invoke: () => input.runtime.modelPort.complete({
      model: input.runtime.model,
      messages: input.request.messages,
      tools: input.runtime.tools,
      toolChoice: input.runtime.toolChoice,
      sessionId: input.loopInput.session.id,
      runId: input.loopInput.run.id,
      step: input.step + 1,
      assistantMessageId: input.runtime.currentAssistantMessage.id,
      studioKind: input.loopInput.session.studioKind,
      runCreatedAt: input.loopInput.run.createdAt,
      requestMessageCount: input.request.messages.length,
      requestMessageCharsApprox: input.request.requestMessageCharsApprox,
      requestToolSchemaCharsApprox: input.request.requestToolSchemaCharsApprox,
      signal: input.loopInput.abortSignal,
    }),
    readUsage: (response) => response.usage
  })

  const choice = completion.choices[0]
  const message = choice?.message
  const result = {
    completion,
    message,
    assistantText: normalizeStudioAssistantText(message?.content),
    toolCalls: message?.tool_calls ?? []
  }

  logStudioLoopStepResponse({
    loopInput: input.loopInput,
    result,
    step: input.step,
    stepStartedAt: input.stepStartedAt
  })
  getStudioTelemetry().timeline({ studioKind: input.loopInput.session.studioKind, name: 'step.response', detail: `${choice?.finish_reason ?? 'unknown'}, ${result.toolCalls.length} toolCalls` })

  return result
}

export async function persistStudioProviderSnapshot(
  input: StudioOpenAIToolLoopInput,
  assistantMessage: StudioAssistantMessage,
  message: StudioChatCompletionMessage | undefined
) {
  await persistProviderMessageSnapshot({
    messageStore: input.messageStore,
    assistantMessage,
    providerMessage: message
  })
}

function justBefore(iso: string): string {
  const parsed = Date.parse(iso)
  return new Date(Number.isFinite(parsed) ? Math.max(0, parsed - 1) : Date.now()).toISOString()
}
