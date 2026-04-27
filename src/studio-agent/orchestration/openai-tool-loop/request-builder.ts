import type { StudioAssistantMessage } from '../../domain/types'
import type OpenAI from 'openai'
import { createCustomOpenAIClient } from '../../../services/openai-client-factory'
import { logPlotStudioSkillTrace } from '../../observability/plot-studio-skill-trace'
import { readStudioRunAutonomyMetadata } from '../../runs/autonomy-policy'
import { buildStudioAgentSystemPrompt } from '../studio-agent-prompt'
import { buildStudioConversationMessages } from '../studio-message-history'
import { createLogger } from '../../../utils/logger'
import {
  persistProviderMessageSnapshot,
  summarizeAssistantMessageForDebug,
  summarizeConversationMessageForDebug,
  summarizeConversationTailForDebug,
} from '../studio-provider-message'
import { requestStudioChatCompletion } from '../studio-provider-request'
import { buildStudioChatTools } from '../studio-tool-schema'
import { normalizeStudioAssistantText } from './message-assembly'
import { logStudioLoopStepResponse, logStudioLoopStepStarted } from './observability'
import type {
  StudioChatCompletionMessage,
  StudioLoopRuntime,
  StudioLoopStepRequest,
  StudioLoopStepResult,
  StudioOpenAIToolLoopInput
} from './types'

const logger = createLogger('StudioLoopRequest')

const DEFAULT_MAX_STEPS = 8

export async function createStudioLoopRuntime(input: StudioOpenAIToolLoopInput): Promise<StudioLoopRuntime> {
  const client = createCustomOpenAIClient(input.customApiConfig)
  const model = (input.customApiConfig.model || '').trim()
  if (!model) {
    throw new Error('Studio agent requires a provider model')
  }

  const tools = buildStudioChatTools(input.registry, input.session.agentType, input.session.studioKind)
  const storedMessages = await input.messageStore.listBySessionId(input.session.id)
  logPlotStudioSkillTrace(input.session.studioKind, 'skill.discovery.requested', {
    sessionId: input.session.id,
    runId: input.run.id,
    agentType: input.session.agentType,
    studioKind: input.session.studioKind,
  })
  const [availableSkills, skillSummaries] = await Promise.all([
    input.listSkills?.(input.session) ?? Promise.resolve([]),
    input.listSkillSummaries?.(input.session) ?? Promise.resolve([])
  ])
  logPlotStudioSkillTrace(input.session.studioKind, 'skill.discovery.completed', {
    sessionId: input.session.id,
    runId: input.run.id,
    discoveredSkillCount: availableSkills.length,
    discoveredSkillNames: availableSkills.map((skill) => skill.name),
  })
  logPlotStudioSkillTrace(input.session.studioKind, 'skill.summary.completed', {
    sessionId: input.session.id,
    runId: input.run.id,
    summaryCount: skillSummaries.length,
    summarySkillNames: skillSummaries.map((summary) => summary.skillName),
  })
  logPlotStudioSkillTrace(input.session.studioKind, 'skill.prompt.catalog', {
    sessionId: input.session.id,
    runId: input.run.id,
    discoveredSkillCount: availableSkills.length,
  })
  logPlotStudioSkillTrace(input.session.studioKind, 'skill.prompt.state', {
    sessionId: input.session.id,
    runId: input.run.id,
    summaryCount: skillSummaries.length,
  })

  return {
    client,
    model,
    tools,
    conversation: buildStudioConversationMessages({ messages: storedMessages }),
    systemPrompt: buildStudioAgentSystemPrompt({
      session: input.session,
      workContext: input.workContext,
      availableSkills,
      skillSummaries
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

  const lastUserOrAssistant = messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-1)[0]
  if (lastUserOrAssistant && lastUserOrAssistant.role === 'assistant') {
    const assistantMsg = lastUserOrAssistant as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & { reasoning_content?: unknown }
    logger.debug('buildStudioLoopStepRequest last assistant', {
      hasReasoningContent: Boolean(assistantMsg.reasoning_content),
      reasoningContentType: typeof assistantMsg.reasoning_content,
      reasoningContentIsArray: Array.isArray(assistantMsg.reasoning_content),
      reasoningContentLength: Array.isArray(assistantMsg.reasoning_content) ? assistantMsg.reasoning_content.length : undefined,
    })
    logger.info('buildStudioLoopStepRequest assistant replay payload', {
      messageCount: messages.length,
      requestMessageCharsApprox: JSON.stringify(messages).length,
      lastAssistant: summarizeConversationMessageForDebug(lastUserOrAssistant),
      conversationTail: summarizeConversationTailForDebug(runtime.conversation),
    })
  }

  return {
    messages,
    requestMessageCharsApprox: JSON.stringify(messages).length,
    requestToolSchemaCharsApprox: JSON.stringify(runtime.tools).length
  }
}

export async function requestStudioLoopStep(input: {
  loopInput: StudioOpenAIToolLoopInput
  runtime: StudioLoopRuntime
  request: StudioLoopStepRequest
  step: number
  stepStartedAt: number
}): Promise<StudioLoopStepResult> {
  logStudioLoopStepStarted({
    loopInput: input.loopInput,
    conversationLength: input.runtime.conversation.length,
    toolCount: input.runtime.tools.length,
    request: input.request,
    step: input.step
  })

  const completion = await requestStudioChatCompletion({
    client: input.runtime.client,
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
  })

  const choice = completion.choices[0]
  const message = choice?.message
  const result = {
    completion,
    message,
    assistantText: normalizeStudioAssistantText(message?.content),
    toolCalls: message?.tool_calls ?? []
  }

  logger.info('requestStudioLoopStep provider response payload', {
    step: input.step + 1,
    finishReason: choice?.finish_reason ?? null,
    assistantMessage: summarizeAssistantMessageForDebug(message),
  })

  logStudioLoopStepResponse({
    loopInput: input.loopInput,
    result,
    step: input.step,
    stepStartedAt: input.stepStartedAt
  })

  return result
}

export async function persistStudioProviderSnapshot(
  input: StudioOpenAIToolLoopInput,
  assistantMessage: StudioAssistantMessage,
  message: StudioChatCompletionMessage | undefined
) {
  logger.info('persistStudioProviderSnapshot before persist', {
    assistantMessageId: assistantMessage.id,
    providerMessage: summarizeAssistantMessageForDebug(message),
  })
  await persistProviderMessageSnapshot({
    messageStore: input.messageStore,
    assistantMessage,
    providerMessage: message
  })
}
