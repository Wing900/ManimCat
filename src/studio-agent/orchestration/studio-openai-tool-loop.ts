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
import { createLogger } from '../../utils/logger'
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
import { determineStudioAgentLoopAction } from './studio-agent-loop-policy'
import { buildStudioChatTools } from './studio-tool-schema'
import { buildStudioPreToolCommentary } from '../runtime/pre-tool-commentary'

const DEFAULT_MAX_STEPS = 8
const logger = createLogger('StudioOpenAIToolLoop')

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

export async function* createStudioOpenAIToolLoop(
  input: StudioOpenAIToolLoopInput
): AsyncGenerator<StudioProcessorStreamEvent> {
  const client = createCustomOpenAIClient(input.customApiConfig)
  const model = (input.customApiConfig.model || '').trim()
  if (!model) {
    throw new Error('Studio agent requires a provider model')
  }

  const tools = buildStudioChatTools(input.registry, input.session.agentType, input.session.studioKind)
  const storedMessages = await input.messageStore.listBySessionId(input.session.id)
  const conversation = buildStudioConversationMessages({
    messages: storedMessages
  })
  const systemPrompt = buildStudioAgentSystemPrompt({
    session: input.session,
    workContext: input.workContext
  })
  let autonomy = readStudioRunAutonomyMetadata(input.run.metadata)
  const maxSteps = input.maxSteps ?? autonomy.maxSteps ?? DEFAULT_MAX_STEPS
  const toolChoice = input.toolChoice ?? 'auto'
  let currentAssistantMessage = input.assistantMessage

  logger.info('Starting Studio OpenAI tool loop', {
    sessionId: input.session.id,
    runId: input.run.id,
    agent: input.session.agentType,
    model,
    toolChoice,
    maxSteps,
    initialAssistantMessageId: currentAssistantMessage.id,
  })

  for (let step = 0; step < maxSteps; step += 1) {
    if (step > 0) {
      currentAssistantMessage = await input.createAssistantMessage()
      yield {
        type: 'assistant-message-start',
        message: currentAssistantMessage
      }
    }

    const nextStepCount = autonomy.stepCount + 1
    await input.onCheckpoint?.({
      metadata: buildStudioRunMetadataPatch({
        metadata: input.run.metadata,
        stepCount: nextStepCount,
      }),
    })
    input.run.metadata = buildStudioRunMetadataPatch({
      metadata: input.run.metadata,
      stepCount: nextStepCount,
    })
    autonomy = readStudioRunAutonomyMetadata(input.run.metadata)

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversation
      ],
      tools,
      tool_choice: toolChoice
    })

    const choice = completion.choices[0]
    const message = choice?.message
    const assistantText = normalizeAssistantText(message?.content)
    const toolCalls = message?.tool_calls ?? []

    logger.info('Received provider response', {
      sessionId: input.session.id,
      runId: input.run.id,
      step: step + 1,
      assistantMessageId: currentAssistantMessage.id,
      finishReason: choice?.finish_reason ?? null,
      toolCallCount: toolCalls.length,
      hasAssistantText: Boolean(assistantText),
    })

    await persistProviderMessageSnapshot({
      messageStore: input.messageStore,
      assistantMessage: currentAssistantMessage,
      providerMessage: message
    })

    if (assistantText) {
      yield { type: 'text-start' }
      yield { type: 'text-delta', text: assistantText }
      yield { type: 'text-end' }
    }

    const nextAction = determineStudioAgentLoopAction({
      finishReason: choice?.finish_reason ?? null,
      toolCallCount: toolCalls.length,
      step,
      maxSteps
    })

    if (nextAction.type === 'finish') {
      await checkpointSuccess(input, autonomy)
      yield {
        type: 'finish-step',
        usage: {
          tokens: completion.usage?.total_tokens
        }
      }
      return
    }

    if (nextAction.type === 'abort') {
      yield { type: 'text-start' }
      yield { type: 'text-delta', text: nextAction.message }
      yield { type: 'text-end' }
      await checkpointFailure(input, autonomy, nextAction.message)
      yield {
        type: 'finish-step',
        usage: {
          tokens: completion.usage?.total_tokens
        }
      }
      return
    }

    conversation.push(toAssistantConversationMessage(message, assistantText, toolCalls))

    let stepFailureMessage: string | null = null
    const hasAssistantText = Boolean(assistantText)
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name
      const toolCallId = toolCall.id
      const parsedInput = parseToolArguments(toolName, toolCall.function.arguments)

      if (!parsedInput.ok) {
        stepFailureMessage = parsedInput.error
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
        conversation.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: parsedInput.error
        })
        break
      }

      let transcript = ''
      for await (const event of createStudioToolCallExecutionEvents({
        projectId: input.projectId,
        session: input.session,
        run: input.run,
        assistantMessage: currentAssistantMessage,
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
        setToolMetadata: (callId, metadata) => input.setToolMetadata(currentAssistantMessage, callId, metadata),
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
          stepFailureMessage = event.error
          const fatal = autonomy.consecutiveFailures + 1 >= autonomy.maxConsecutiveFailures
          yield {
            ...event,
            metadata: {
              ...(event.metadata ?? {}),
              recoverable: !fatal,
              failureCount: autonomy.consecutiveFailures + 1,
            }
          }
          break
        }

        yield event
      }

      conversation.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: transcript || '(no tool output)'
      })

      if (stepFailureMessage) {
        break
      }
    }

    if (stepFailureMessage) {
      autonomy = await checkpointFailure(input, autonomy, stepFailureMessage)
      if (autonomy.consecutiveFailures >= autonomy.maxConsecutiveFailures) {
        const stopMessage = `Stopped after ${autonomy.consecutiveFailures} consecutive failures: ${stepFailureMessage}`
        yield { type: 'text-start' }
        yield { type: 'text-delta', text: stopMessage }
        yield { type: 'text-end' }
        await input.onCheckpoint?.({
          metadata: buildStudioRunMetadataPatch({
            metadata: input.run.metadata,
            stepCount: autonomy.stepCount,
            consecutiveFailures: autonomy.consecutiveFailures,
            stopReason: stopMessage,
          }),
        })
        input.run.metadata = buildStudioRunMetadataPatch({
          metadata: input.run.metadata,
          stepCount: autonomy.stepCount,
          consecutiveFailures: autonomy.consecutiveFailures,
          stopReason: stopMessage,
        })
        yield {
          type: 'finish-step',
          usage: {
            tokens: completion.usage?.total_tokens
          }
        }
        return
      }
    } else {
      autonomy = await checkpointSuccess(input, autonomy)
    }

    yield {
      type: 'finish-step',
      usage: {
        tokens: completion.usage?.total_tokens
      }
    }
  }
}

async function checkpointSuccess(input: StudioOpenAIToolLoopInput, autonomy: ReturnType<typeof readStudioRunAutonomyMetadata>) {
  const metadata = buildStudioRunMetadataPatch({
    metadata: input.run.metadata,
    stepCount: autonomy.stepCount,
    consecutiveFailures: 0,
    stopReason: null,
  })
  await input.onCheckpoint?.({ metadata })
  input.run.metadata = metadata
  return readStudioRunAutonomyMetadata(metadata)
}

async function checkpointFailure(
  input: StudioOpenAIToolLoopInput,
  autonomy: ReturnType<typeof readStudioRunAutonomyMetadata>,
  message: string
) {
  const metadata = buildStudioRunMetadataPatch({
    metadata: input.run.metadata,
    stepCount: autonomy.stepCount,
    consecutiveFailures: autonomy.consecutiveFailures + 1,
    stopReason: message,
  })
  await input.onCheckpoint?.({ metadata })
  input.run.metadata = metadata
  return readStudioRunAutonomyMetadata(metadata)
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

function toAssistantConversationMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
  assistantText: string,
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  return {
    role: 'assistant',
    content: message?.content ?? (assistantText || null),
    tool_calls: toolCalls.length
      ? toolCalls.map((toolCall) => ({
          ...toolCall,
          function: {
            ...toolCall.function,
            arguments: toolCall.function.arguments
          }
        }))
      : undefined
  }
}

async function persistProviderMessageSnapshot(input: {
  messageStore: StudioMessageStore
  assistantMessage: StudioAssistantMessage
  providerMessage?: OpenAI.Chat.Completions.ChatCompletionMessage
}): Promise<void> {
  if (!input.providerMessage) {
    return
  }

  const metadata = {
    ...(input.assistantMessage.metadata ?? {}),
    providerMessage: {
      content: input.providerMessage.content ?? null,
      tool_calls: input.providerMessage.tool_calls?.map((toolCall) => ({
        ...toolCall,
        function: {
          ...toolCall.function,
          arguments: toolCall.function.arguments
        }
      })) ?? []
    }
  }

  input.assistantMessage.metadata = metadata
  await input.messageStore.updateAssistantMessage(input.assistantMessage.id, {
    metadata
  })
}

