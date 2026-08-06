import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { StudioProcessorStreamEvent } from '../../domain/types'
import { throwIfStudioRunCancelled } from '../../runtime/execution/run-cancellation'
import { buildStudioPreToolCommentary } from '../../runtime/tools/pre-tool-commentary'
import { createStudioToolCallExecutionEvents } from '../../runtime/tools/tool-call-adapter'
import { logPlotStudioTiming, logTimeline, readRunElapsedMs } from '../../observability/plot-studio-timing'
import { getStudioModeDefinition } from '../../modes/studio-mode'
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

    // Apply the mode-declared automatic render policy after successful edits.
    const mode = getStudioModeDefinition(input.session.studioKind)
    if (mode.autoRenderAfterTools.includes(toolCall.function.name) && !toolResult.value.failureMessage) {
      const autoRender = executeAutoRender(input, runtime, toolCall, autonomy)
      let autoResult: IteratorResult<StudioProcessorStreamEvent, { transcript: string; failureMessage: string | null }>
      while (true) {
        autoResult = await autoRender.next()
        if (autoResult.done) {
          break
        }
        yield autoResult.value
      }

      if (autoResult.value.transcript) {
        runtime.conversation.push({
          role: 'tool',
          tool_call_id: `auto_render_${toolCall.id}`,
          content: autoResult.value.transcript
        })
      }
    }
  }

  return { failureMessage: null }
}

async function* executeStudioSingleToolCall(
  input: StudioOpenAIToolLoopInput,
  runtime: StudioLoopRuntime,
  toolCall: StudioChatToolCall,
  autonomy: StudioLoopAutonomy,
  hasAssistantText: boolean
): AsyncGenerator<StudioProcessorStreamEvent, { transcript: string; failureMessage: string | null }> {
  const toolName = toolCall.function.name
  const toolCallId = toolCall.id
  const parsedInput = parseStudioToolArguments(toolName, toolCall.function.arguments)
  throwIfStudioRunCancelled(input.abortSignal)

  if (!parsedInput.ok) {
    const fatal = autonomy.consecutiveFailures + 1 >= autonomy.maxConsecutiveFailures
    logPlotStudioTiming(input.session.studioKind, 'tool.failure.detected', {
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
    }, 'warn')
    logTimeline(input.session.studioKind, 'tool.failure', `${toolName} argument_parse`)
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
    messageStore: input.messageStore,
    partStore: input.partStore,
    sessionStore: input.sessionStore,
    renderStore: input.renderStore,
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

async function* executeAutoRender(
  input: StudioOpenAIToolLoopInput,
  runtime: StudioLoopRuntime,
  writeToolCall: StudioChatToolCall,
  autonomy: StudioLoopAutonomy
): AsyncGenerator<StudioProcessorStreamEvent, { transcript: string; failureMessage: string | null }> {
  const parsedInput = parseStudioToolArguments(writeToolCall.function.name, writeToolCall.function.arguments)
  if (!parsedInput.ok) {
    return { transcript: '', failureMessage: null }
  }

  const filePath = extractFilePath(parsedInput.value)
  if (!filePath) {
    return { transcript: '', failureMessage: null }
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(input.session.directory, filePath)

  let code: string
  try {
    code = await readFile(resolvedPath, 'utf8')
  } catch {
    logTimeline(input.session.studioKind, 'auto-render.skip', `cannot read ${filePath}`)
    return { transcript: '', failureMessage: null }
  }

  if (!code.trim()) {
    return { transcript: '', failureMessage: null }
  }

  const fileName = path.basename(resolvedPath)
  const concept = `Auto-render after write: ${fileName}`
  const autoRenderCallId = `auto_render_${writeToolCall.id}`

  logTimeline(input.session.studioKind, 'auto-render.started', fileName)

  for await (const event of createStudioToolCallExecutionEvents({
    projectId: input.projectId,
    session: input.session,
    run: input.run,
    assistantMessage: runtime.currentAssistantMessage,
    toolCallId: autoRenderCallId,
    toolName: 'render',
    toolInput: { concept, code },
    registry: input.registry,
    eventBus: input.eventBus,
    messageStore: input.messageStore,
    partStore: input.partStore,
    sessionStore: input.sessionStore,
    renderStore: input.renderStore,
    setToolMetadata: (callId, metadata) => input.setToolMetadata(runtime.currentAssistantMessage, callId, metadata),
    abortSignal: input.abortSignal,
    commentary: null,
  })) {
    if (event.type === 'tool-result') {
      logTimeline(input.session.studioKind, 'auto-render.completed', fileName)
    }
    if (event.type === 'tool-error') {
      logTimeline(input.session.studioKind, 'auto-render.failed', `${fileName}: ${event.error}`)
    }
    yield event
  }

  return { transcript: '', failureMessage: null }
}

function extractFilePath(toolInput: Record<string, unknown>): string | null {
  const candidate = toolInput.path ?? toolInput.file ?? toolInput.filePath
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}
