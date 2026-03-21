import OpenAI from 'openai'
import type {
  StudioAssistantMessage,
  StudioMessageStore,
  StudioPermissionRequest,
  StudioProcessorStreamEvent,
  StudioRun,
  StudioSession,
  StudioSessionStore,
  StudioTaskStore,
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
import { buildStudioAgentSystemPrompt } from './studio-agent-prompt'
import { buildStudioConversationMessages } from './studio-message-history'
import { buildStudioChatTools } from './studio-tool-schema'

const DEFAULT_MAX_STEPS = 8

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
  setToolMetadata: (callId: string, metadata: { title?: string; metadata?: Record<string, unknown> }) => void
  customApiConfig: CustomApiConfig
  maxSteps?: number
}

export async function* createStudioOpenAIToolLoop(
  input: StudioOpenAIToolLoopInput
): AsyncGenerator<StudioProcessorStreamEvent> {
  const client = createCustomOpenAIClient(input.customApiConfig)
  const model = (input.customApiConfig.model || '').trim()
  if (!model) {
    throw new Error('Studio agent requires a provider model')
  }

  const tools = buildStudioChatTools(input.registry, input.session.agentType)
  const storedMessages = await input.messageStore.listBySessionId(input.session.id)
  const conversation = buildStudioConversationMessages({
    messages: storedMessages
  })
  const systemPrompt = buildStudioAgentSystemPrompt({
    session: input.session,
    workContext: input.workContext
  })
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS

  for (let step = 0; step < maxSteps; step += 1) {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversation
      ],
      tools,
      tool_choice: 'auto'
    })

    const choice = completion.choices[0]
    const message = choice?.message
    const assistantText = normalizeAssistantText(message?.content)
    const toolCalls = message?.tool_calls ?? []

    if (assistantText) {
      yield { type: 'text-start' }
      yield { type: 'text-delta', text: assistantText }
      yield { type: 'text-end' }
    }

    if (toolCalls.length === 0) {
      yield {
        type: 'finish-step',
        usage: {
          tokens: completion.usage?.total_tokens
        }
      }
      return
    }

    conversation.push({
      role: 'assistant',
      content: assistantText || null,
      tool_calls: toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        }
      }))
    })

    let shouldStop = false
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name
      const toolCallId = toolCall.id
      const parsedInput = parseToolArguments(toolName, toolCall.function.arguments)

      if (!parsedInput.ok) {
        shouldStop = true
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
          error: parsedInput.error
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
        assistantMessage: input.assistantMessage,
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
        setToolMetadata: input.setToolMetadata,
        customApiConfig: input.customApiConfig
      })) {
        transcript = eventToTranscript(event, transcript)
        if (event.type === 'tool-error') {
          shouldStop = true
        }
        yield event
      }

      conversation.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: transcript || '(no tool output)'
      })

      if (shouldStop) {
        break
      }
    }

    yield {
      type: 'finish-step',
      usage: {
        tokens: completion.usage?.total_tokens
      }
    }

    if (shouldStop) {
      return
    }
  }

  const stepLimitMessage = `Stopped after reaching the Studio agent step limit (${maxSteps}).`
  yield { type: 'text-start' }
  yield { type: 'text-delta', text: stepLimitMessage }
  yield { type: 'text-end' }
  yield { type: 'finish-step' }
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


