import type OpenAI from 'openai'
import type {
  StudioAssistantMessage,
  StudioMessageStore,
  StudioPermissionRequest,
  StudioProcessorStreamEvent,
  StudioRun,
  StudioSession,
  StudioSessionStore,
  StudioTaskStore,
  StudioToolChoice,
  StudioWorkContext,
  StudioWorkResultStore,
  StudioWorkStore
} from '../domain/types'
import { createCustomOpenAIClient } from '../../services/openai-client-factory'
import type { StudioPermissionService } from '../permissions/permission-service'
import type { StudioToolRegistry } from '../tools/registry'
import { createStudioToolCallExecutionEvents } from '../runtime/tool-call-adapter'
import type {
  StudioResolvedSkill,
  StudioRuntimeBackedToolContext,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from '../runtime/tool-runtime-context'
import type { CustomApiConfig } from '../../types'
import {
  buildStudioRunMetadataPatch,
  readStudioRunAutonomyMetadata,
} from '../runs/autonomy-policy'
import { buildStudioAgentSystemPrompt } from './studio-agent-prompt'
import { buildStudioConversationMessages } from './studio-message-history'
import {
  persistProviderMessageSnapshot,
  toAssistantConversationMessage,
} from './studio-provider-message'
import { requestStudioChatCompletion } from './studio-provider-request'
import { determineStudioAgentLoopAction } from './studio-agent-loop-policy'
import { buildStudioChatTools } from './studio-tool-schema'
import { buildStudioPreToolCommentary } from '../runtime/pre-tool-commentary'
import { logPlotStudioTiming, readElapsedMs, readRunElapsedMs } from '../observability/plot-studio-timing'

const DEFAULT_MAX_STEPS = 8

type StudioLoopAutonomy = ReturnType<typeof readStudioRunAutonomyMetadata>
type StudioChatCompletion = Awaited<ReturnType<typeof requestStudioChatCompletion>>
type StudioChatCompletionMessage = NonNullable<StudioChatCompletion['choices'][number]['message']>
type StudioChatToolCall = NonNullable<StudioChatCompletionMessage['tool_calls']>[number]

interface StudioOpenAIToolLoopInput {
  projectId: string
  session: StudioSession
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  inputText: string
  messageStore: StudioMessageStore
  registry: StudioToolRegistry
  eventBus: StudioRuntimeBackedToolContext['eventBus']
  permissionService?: StudioPermissionService
  sessionStore?: StudioSessionStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  workContext?: StudioWorkContext
  askForConfirmation?: (request: StudioPermissionRequest) => Promise<'once' | 'always' | 'reject'>
  runSubagent?: (input: StudioSubagentRunRequest) => Promise<StudioSubagentRunResult>
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
  createAssistantMessage: () => Promise<StudioAssistantMessage>
  setToolMetadata: (assistantMessage: StudioAssistantMessage, callId: string, metadata: { title?: string; metadata?: Record<string, unknown> }) => void
  customApiConfig: CustomApiConfig
  maxSteps?: number
  toolChoice?: StudioToolChoice
  onCheckpoint?: (patch: Partial<StudioRun>) => Promise<void>
}

interface StudioLoopRuntime {
  client: OpenAI
  model: string
  tools: ReturnType<typeof buildStudioChatTools>
  conversation: ReturnType<typeof buildStudioConversationMessages>
  systemPrompt: string
  maxSteps: number
  toolChoice: StudioToolChoice
  currentAssistantMessage: StudioAssistantMessage
}

interface StudioLoopStepRequest {
  messages: Array<{ role: 'system'; content: string } | ReturnType<typeof buildStudioConversationMessages>[number]>
  requestMessageCharsApprox: number
  requestToolSchemaCharsApprox: number
}

interface StudioLoopStepResult {
  completion: StudioChatCompletion
  message: StudioChatCompletionMessage | undefined
  assistantText: string
  toolCalls: StudioChatToolCall[]
}

interface StudioToolExecutionResult {
  failureMessage: string | null
}

class StudioLoopCheckpointManager {
  private autonomy: StudioLoopAutonomy

  constructor(private readonly input: StudioOpenAIToolLoopInput) {
    this.autonomy = readStudioRunAutonomyMetadata(input.run.metadata)
  }

  async beginStep() {
    return this.apply(buildStudioRunMetadataPatch({
      metadata: this.input.run.metadata,
      stepCount: this.autonomy.stepCount + 1,
    }))
  }

  async markSuccess() {
    return this.apply(buildStudioRunMetadataPatch({
      metadata: this.input.run.metadata,
      stepCount: this.autonomy.stepCount,
      consecutiveFailures: 0,
      stopReason: null,
    }))
  }

  async markFailure(message: string) {
    return this.apply(buildStudioRunMetadataPatch({
      metadata: this.input.run.metadata,
      stepCount: this.autonomy.stepCount,
      consecutiveFailures: this.autonomy.consecutiveFailures + 1,
      stopReason: message,
    }))
  }

  async markStopped(message: string) {
    return this.apply(buildStudioRunMetadataPatch({
      metadata: this.input.run.metadata,
      stepCount: this.autonomy.stepCount,
      consecutiveFailures: this.autonomy.consecutiveFailures,
      stopReason: message,
    }))
  }

  private async apply(metadata: Record<string, unknown>) {
    await this.input.onCheckpoint?.({ metadata })
    this.input.run.metadata = metadata
    this.autonomy = readStudioRunAutonomyMetadata(metadata)
    return this.autonomy
  }
}

export async function* createStudioOpenAIToolLoop(
  input: StudioOpenAIToolLoopInput
): AsyncGenerator<StudioProcessorStreamEvent> {
  const runtime = await createLoopRuntime(input)
  const checkpoints = new StudioLoopCheckpointManager(input)

  for (let step = 0; step < runtime.maxSteps; step += 1) {
    const stepStartedAt = Date.now()
    if (step > 0) {
      runtime.currentAssistantMessage = await input.createAssistantMessage()
      yield {
        type: 'assistant-message-start',
        message: runtime.currentAssistantMessage
      }
    }

    const autonomy = await checkpoints.beginStep()
    const request = buildStepRequest(runtime)
    const result = await requestLoopStep(input, runtime, request, step, stepStartedAt)

    await persistProviderSnapshot(input, runtime.currentAssistantMessage, result.message)
    yield* emitAssistantText(result.assistantText)

    const nextAction = determineStudioAgentLoopAction({
      finishReason: result.completion.choices[0]?.finish_reason ?? null,
      toolCallCount: result.toolCalls.length,
      step,
      maxSteps: runtime.maxSteps
    })

    if (nextAction.type === 'finish') {
      await checkpoints.markSuccess()
      yield finishStepEvent(result.completion)
      return
    }

    if (nextAction.type === 'abort') {
      yield* emitAssistantText(nextAction.message)
      await checkpoints.markFailure(nextAction.message)
      yield finishStepEvent(result.completion)
      return
    }

    runtime.conversation.push(toAssistantConversationMessage(result.message, result.assistantText, result.toolCalls))

    const toolIterator = executeToolCallsForStep(input, runtime, result, autonomy)
    let toolExecution: IteratorResult<StudioProcessorStreamEvent, StudioToolExecutionResult>
    while (true) {
      toolExecution = await toolIterator.next()
      if (toolExecution.done) {
        break
      }
      yield toolExecution.value
    }

    if (toolExecution.value.failureMessage) {
      const failedAutonomy = await checkpoints.markFailure(toolExecution.value.failureMessage)
      if (failedAutonomy.consecutiveFailures >= failedAutonomy.maxConsecutiveFailures) {
        const stopMessage = `Stopped after ${failedAutonomy.consecutiveFailures} consecutive failures: ${toolExecution.value.failureMessage}`
        yield* emitAssistantText(stopMessage)
        await checkpoints.markStopped(stopMessage)
        yield finishStepEvent(result.completion)
        return
      }
    } else {
      await checkpoints.markSuccess()
    }

    logPlotStudioTiming(input.session.studioKind, 'step.finished', {
      sessionId: input.session.id,
      runId: input.run.id,
      step: step + 1,
      status: toolExecution.value.failureMessage ? 'failed' : 'completed',
      stepDurationMs: readElapsedMs(stepStartedAt),
      runElapsedMs: readRunElapsedMs(input.run),
    })

    yield finishStepEvent(result.completion)
  }
}

async function createLoopRuntime(input: StudioOpenAIToolLoopInput): Promise<StudioLoopRuntime> {
  const client = createCustomOpenAIClient(input.customApiConfig)
  const model = (input.customApiConfig.model || '').trim()
  if (!model) {
    throw new Error('Studio agent requires a provider model')
  }

  const tools = buildStudioChatTools(input.registry, input.session.agentType, input.session.studioKind)
  const storedMessages = await input.messageStore.listBySessionId(input.session.id)

  return {
    client,
    model,
    tools,
    conversation: buildStudioConversationMessages({ messages: storedMessages }),
    systemPrompt: buildStudioAgentSystemPrompt({
      session: input.session,
      workContext: input.workContext
    }),
    maxSteps: input.maxSteps ?? readStudioRunAutonomyMetadata(input.run.metadata).maxSteps ?? DEFAULT_MAX_STEPS,
    toolChoice: input.toolChoice ?? 'auto',
    currentAssistantMessage: input.assistantMessage
  }
}

function buildStepRequest(runtime: StudioLoopRuntime): StudioLoopStepRequest {
  const messages = [
    { role: 'system' as const, content: runtime.systemPrompt },
    ...runtime.conversation
  ]

  return {
    messages,
    requestMessageCharsApprox: JSON.stringify(messages).length,
    requestToolSchemaCharsApprox: JSON.stringify(runtime.tools).length
  }
}

async function requestLoopStep(
  input: StudioOpenAIToolLoopInput,
  runtime: StudioLoopRuntime,
  request: StudioLoopStepRequest,
  step: number,
  stepStartedAt: number
): Promise<StudioLoopStepResult> {
  logPlotStudioTiming(input.session.studioKind, 'step.started', {
    sessionId: input.session.id,
    runId: input.run.id,
    step: step + 1,
    conversationMessages: runtime.conversation.length + 1,
    toolCount: runtime.tools.length,
    requestMessageCharsApprox: request.requestMessageCharsApprox,
    requestToolSchemaCharsApprox: request.requestToolSchemaCharsApprox,
    runElapsedMs: readRunElapsedMs(input.run),
  })

  const completion = await requestStudioChatCompletion({
    client: runtime.client,
    model: runtime.model,
    messages: request.messages,
    tools: runtime.tools,
    toolChoice: runtime.toolChoice,
    sessionId: input.session.id,
    runId: input.run.id,
    step: step + 1,
    assistantMessageId: runtime.currentAssistantMessage.id,
    studioKind: input.session.studioKind,
    runCreatedAt: input.run.createdAt,
    requestMessageCount: request.messages.length,
    requestMessageCharsApprox: request.requestMessageCharsApprox,
    requestToolSchemaCharsApprox: request.requestToolSchemaCharsApprox,
  })

  const choice = completion.choices[0]
  const message = choice?.message
  const assistantText = normalizeAssistantText(message?.content)
  const toolCalls = message?.tool_calls ?? []

  logPlotStudioTiming(input.session.studioKind, 'step.response', {
    sessionId: input.session.id,
    runId: input.run.id,
    step: step + 1,
    finishReason: choice?.finish_reason ?? null,
    toolCallCount: toolCalls.length,
    assistantTextLength: assistantText.length,
    stepDurationMs: readElapsedMs(stepStartedAt),
    runElapsedMs: readRunElapsedMs(input.run),
  })

  return {
    completion,
    message,
    assistantText,
    toolCalls
  }
}

async function persistProviderSnapshot(
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

async function* emitAssistantText(text: string): AsyncGenerator<StudioProcessorStreamEvent> {
  if (!text) {
    return
  }

  yield { type: 'text-start' }
  yield { type: 'text-delta', text }
  yield { type: 'text-end' }
}

async function* executeToolCallsForStep(
  input: StudioOpenAIToolLoopInput,
  runtime: StudioLoopRuntime,
  result: StudioLoopStepResult,
  autonomy: StudioLoopAutonomy
): AsyncGenerator<StudioProcessorStreamEvent, StudioToolExecutionResult> {
  const hasAssistantText = Boolean(result.assistantText)

  for (const toolCall of result.toolCalls) {
    const execution = executeSingleToolCall(input, runtime, toolCall, autonomy, hasAssistantText)
    let toolResult: IteratorResult<StudioProcessorStreamEvent, { transcript: string; failureMessage: string | null }>
    while (true) {
      toolResult = await execution.next()
      if (toolResult.done) {
        break
      }
      yield toolResult.value
    }

    runtime.conversation.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: toolResult.value.transcript || '(no tool output)'
    })

    if (toolResult.value.failureMessage) {
      return { failureMessage: toolResult.value.failureMessage }
    }
  }

  return { failureMessage: null }
}

async function* executeSingleToolCall(
  input: StudioOpenAIToolLoopInput,
  runtime: StudioLoopRuntime,
  toolCall: StudioChatToolCall,
  autonomy: StudioLoopAutonomy,
  hasAssistantText: boolean
): AsyncGenerator<StudioProcessorStreamEvent, { transcript: string; failureMessage: string | null }> {
  const toolName = toolCall.function.name
  const toolCallId = toolCall.id
  const parsedInput = parseToolArguments(toolName, toolCall.function.arguments)

  if (!parsedInput.ok) {
    const fatal = autonomy.consecutiveFailures + 1 >= autonomy.maxConsecutiveFailures
    yield {
      type: 'tool-input-start',
      id: toolCallId,
      toolName,
      raw: toolCall.function.arguments
    }
    yield {
      type: 'tool-call',
      toolCallId,
      toolName,
      input: {}
    }
    yield {
      type: 'tool-error',
      toolCallId,
      error: parsedInput.error,
      metadata: {
        recoverable: !fatal,
        failureCount: autonomy.consecutiveFailures + 1,
      }
    }

    return {
      transcript: parsedInput.error,
      failureMessage: parsedInput.error
    }
  }

  let transcript = ''
  for await (const event of createStudioToolCallExecutionEvents({
    projectId: input.projectId,
    session: input.session,
    run: input.run,
    assistantMessage: runtime.currentAssistantMessage,
    toolCallId,
    toolName,
    toolInput: parsedInput.value,
    registry: input.registry,
    eventBus: input.eventBus,
    permissionService: input.permissionService,
    sessionStore: input.sessionStore,
    taskStore: input.taskStore,
    workStore: input.workStore,
    workResultStore: input.workResultStore,
    askForConfirmation: input.askForConfirmation,
    runSubagent: input.runSubagent,
    resolveSkill: input.resolveSkill,
    setToolMetadata: (callId, metadata) => input.setToolMetadata(runtime.currentAssistantMessage, callId, metadata),
    customApiConfig: input.customApiConfig,
    commentary: hasAssistantText
      ? null
      : buildStudioPreToolCommentary({
          toolName,
          toolInput: parsedInput.value
        })
  })) {
    transcript = eventToTranscript(event, transcript)
    if (event.type === 'tool-error') {
      const fatal = autonomy.consecutiveFailures + 1 >= autonomy.maxConsecutiveFailures
      yield {
        ...event,
        metadata: {
          ...(event.metadata ?? {}),
          recoverable: !fatal,
          failureCount: autonomy.consecutiveFailures + 1,
        }
      }
      return {
        transcript,
        failureMessage: event.error
      }
    }

    yield event
  }

  return {
    transcript,
    failureMessage: null
  }
}

function finishStepEvent(completion: StudioChatCompletion): StudioProcessorStreamEvent {
  return {
    type: 'finish-step',
    usage: {
      tokens: completion.usage?.total_tokens
    }
  }
}

function normalizeAssistantText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return ''
      }
      const typedPart = part as { type?: unknown; text?: unknown }
      return typedPart.type === 'text' && typeof typedPart.text === 'string' ? typedPart.text : ''
    })
    .join('')
    .trim()
}

function parseToolArguments(
  toolName: string,
  rawArguments: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!rawArguments.trim()) {
    return { ok: true, value: {} }
  }

  try {
    const parsed = JSON.parse(rawArguments)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: `Tool ${toolName} arguments must be a JSON object.` }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return {
      ok: false,
      error: `Tool ${toolName} arguments could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function eventToTranscript(event: StudioProcessorStreamEvent, current: string): string {
  if (event.type === 'tool-result') {
    return event.output || '(empty tool result)'
  }
  if (event.type === 'tool-error') {
    return `Tool execution failed: ${event.error}`
  }
  return current
}
