import type { StudioProcessorStreamEvent } from '../../domain/types'
import { throwIfStudioRunCancelled } from '../../runtime/execution/run-cancellation'
import { buildStudioPreToolCommentary } from '../../runtime/tools/pre-tool-commentary'
import { createStudioToolCallExecutionEvents } from '../../runtime/tools/tool-call-adapter'
import { getStudioTelemetry, readRunElapsedMs } from '../../observability/studio-telemetry'
import type {
  StudioChatToolCall,
  StudioLoopAutonomy,
  StudioLoopRuntime,
  StudioLoopStepResult,
  StudioOpenAIToolLoopInput
} from './types'

export async function* executeStudioToolCallsForStep(
  input: StudioOpenAIToolLoopInput,
  runtime: StudioLoopRuntime,
  result: StudioLoopStepResult,
  autonomy: StudioLoopAutonomy
): AsyncGenerator<StudioProcessorStreamEvent, { failureMessage: string | null }> {
  const hasAssistantText = Boolean(result.assistantText)

  for (const toolCall of result.toolCalls) {
    throwIfStudioRunCancelled(input.abortSignal)
    const execution = executeStudioSingleToolCall(input, runtime, toolCall, autonomy, hasAssistantText)
    let toolResult: IteratorResult<StudioProcessorStreamEvent, StudioSingleToolCallOutcome>
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

/**
 * Internal structured outcome of one Tool call.
 */
interface StudioSingleToolCallOutcome {
  transcript: string
  failureMessage: string | null
}

async function* executeStudioSingleToolCall(
  input: StudioOpenAIToolLoopInput,
  runtime: StudioLoopRuntime,
  toolCall: StudioChatToolCall,
  autonomy: StudioLoopAutonomy,
  hasAssistantText: boolean
): AsyncGenerator<StudioProcessorStreamEvent, StudioSingleToolCallOutcome> {
  const toolName = toolCall.function.name
  const toolCallId = toolCall.id
  const parsedInput = parseStudioToolArguments(toolName, toolCall.function.arguments)
  throwIfStudioRunCancelled(input.abortSignal)

  if (!parsedInput.ok) {
    const fatal = autonomy.consecutiveFailures + 1 >= autonomy.maxConsecutiveFailures
    getStudioTelemetry().event({ studioKind: input.session.studioKind, name: 'tool.failure.detected', data: {
      sessionId: input.session.id,
      runId: input.run.id,
      assistantMessageId: runtime.currentAssistantMessage.id,
      toolName,
      callId: toolCallId,
      failureStage: 'argument_parse',
      failureKind: 'invalid_arguments',
      error: parsedInput.error,
      rawArgumentsPreview: summarizeRawArguments(toolCall.function.arguments),
      runElapsedMs: readRunElapsedMs(input.run),
    }, level: 'warn' })
    getStudioTelemetry().timeline({ studioKind: input.session.studioKind, name: 'tool.failure', detail: `${toolName} argument_parse` })
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
        failureStage: 'argument_parse',
        failureKind: 'invalid_arguments',
        rawArgumentsPreview: summarizeRawArguments(toolCall.function.arguments),
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
    renderStore: input.renderStore,
    executionScope: input.executionScope,
    setToolMetadata: (callId, metadata) => input.setToolMetadata(runtime.currentAssistantMessage, callId, metadata),
    abortSignal: input.abortSignal,
    commentary: hasAssistantText
      ? null
      : buildStudioPreToolCommentary({
          toolName,
          toolInput: parsedInput.value
        })
  })) {
    transcript = studioEventToTranscript(event, transcript)
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

function summarizeRawArguments(rawArguments: string): string {
  if (rawArguments.length <= 300) {
    return rawArguments
  }
  return `${rawArguments.slice(0, 297)}...`
}

function parseStudioToolArguments(
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

function studioEventToTranscript(event: StudioProcessorStreamEvent, current: string): string {
  if (event.type === 'tool-result') {
    return event.output || '(empty tool result)'
  }
  if (event.type === 'tool-error') {
    return `Tool execution failed: ${event.error}`
  }
  return current
}
