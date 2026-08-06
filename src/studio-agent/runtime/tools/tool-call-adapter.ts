import type {
  StudioAssistantMessage,
  StudioProcessorStreamEvent,
  StudioRun,
  StudioSession,
  StudioSessionStore,
  StudioTaskStore,
  StudioToolDefinition,
  StudioWorkResultStore,
  StudioWorkStore
} from '../../domain/types'
import path from 'node:path'
import type { StudioToolRegistry } from '../../tools/registry'
import type { StudioRuntimeBackedToolContext } from './tool-runtime-context'
import type { CustomApiConfig } from '../../../types'
import { buildStudioPreToolCommentary } from './pre-tool-commentary'
import { logPlotStudioTiming, readRunElapsedMs } from '../../observability/plot-studio-timing'
import { WorkspacePathError } from '../../tools/workspace-paths'

export interface StudioToolCallExecutionOptions {
  projectId: string
  session: StudioSession
  run: StudioRun
  assistantMessage: StudioAssistantMessage
  toolCallId: string
  toolName: string
  toolInput: Record<string, unknown>
  registry: StudioToolRegistry
  eventBus: StudioRuntimeBackedToolContext['eventBus']
  messageStore?: StudioRuntimeBackedToolContext['messageStore']
  partStore?: StudioRuntimeBackedToolContext['partStore']
  sessionStore?: StudioSessionStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  setToolMetadata: (callId: string, metadata: { title?: string; metadata?: Record<string, unknown> }) => void
  customApiConfig?: CustomApiConfig
  commentary?: string | null
  abortSignal?: AbortSignal
}

export async function* createStudioToolCallExecutionEvents(
  input: StudioToolCallExecutionOptions
): AsyncGenerator<StudioProcessorStreamEvent> {
  const tool = input.registry.get(input.toolName, input.session.studioKind)
  const commentary = input.commentary === undefined
    ? buildStudioPreToolCommentary({
        toolName: input.toolName,
        toolInput: input.toolInput
      })
    : input.commentary?.trim() ?? ''

  if (commentary) {
    yield { type: 'text-start' }
    yield { type: 'text-delta', text: commentary }
    yield { type: 'text-end' }
  }

  yield {
    type: 'tool-input-start',
    id: input.toolCallId,
    toolName: input.toolName,
    raw: JSON.stringify(input.toolInput)
  }

  yield {
    type: 'tool-call',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    input: input.toolInput
  }

  if (!tool) {
    logDetectedToolFailure(input, {
      error: `Tool not found: ${input.toolName}`,
      failureStage: 'registry',
      failureKind: 'tool_not_found',
    })
    yield createToolErrorEvent(input.toolCallId, `Tool not found: ${input.toolName}`, {
      failureStage: 'registry',
      failureKind: 'tool_not_found',
    })
    return
  }

  try {
    const result = await executeTool({
      tool,
      options: input
    })

    yield {
      type: 'tool-result',
      toolCallId: input.toolCallId,
      title: result.title,
      output: result.output,
      metadata: result.metadata,
      attachments: result.attachments
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const pathEscape = toWorkspacePathFailureDetails(error)
    logDetectedToolFailure(input, {
      error: message,
      failureStage: 'execution',
      failureKind: 'exception',
      errorName: error instanceof Error ? error.name : undefined,
      stackPreview: error instanceof Error ? summarizeStack(error.stack) : undefined,
      ...pathEscape,
    })
    yield createToolErrorEvent(
      input.toolCallId,
      message,
      {
        failureStage: 'execution',
        failureKind: 'exception',
        errorName: error instanceof Error ? error.name : undefined,
        ...pathEscape,
      }
    )
  }
}

async function executeTool(input: {
  tool: StudioToolDefinition
  options: StudioToolCallExecutionOptions
}) {
  const toolContext = {
    projectId: input.options.projectId,
    session: input.options.session,
    run: input.options.run,
    abortSignal: input.options.abortSignal,
    assistantMessage: input.options.assistantMessage,
    eventBus: input.options.eventBus,
    messageStore: input.options.messageStore,
    partStore: input.options.partStore,
    taskStore: input.options.taskStore,
    workStore: input.options.workStore,
    workResultStore: input.options.workResultStore,
    setToolMetadata: (metadata: { title?: string; metadata?: Record<string, unknown> }) => {
      input.options.setToolMetadata(input.options.toolCallId, metadata)
    },
    sessionStore: input.options.sessionStore
  } as StudioRuntimeBackedToolContext

  const normalizedToolInput = injectToolDefaults(
    input.options.toolName,
    input.options.toolInput,
    input.options.customApiConfig
  )

  return input.tool.execute(normalizedToolInput, toolContext)
}

function injectToolDefaults(
  toolName: string,
  toolInput: Record<string, unknown>,
  customApiConfig?: CustomApiConfig
): Record<string, unknown> {
  if (toolName !== 'render' || !customApiConfig || 'customApiConfig' in toolInput) {
    return toolInput
  }

  return {
    ...toolInput,
    customApiConfig
  }
}

function createToolErrorEvent(
  toolCallId: string,
  error: string,
  metadata?: Record<string, unknown>
): StudioProcessorStreamEvent {
  return {
    type: 'tool-error',
    toolCallId,
    error,
    metadata
  }
}

function logDetectedToolFailure(
  input: StudioToolCallExecutionOptions,
  details: {
    error: string
    failureStage: string
    failureKind: string
    permission?: string
    errorName?: string
    stackPreview?: string
    targetPath?: string
    resolvedPath?: string
    workspaceRoot?: string
    allowedRoots?: string[]
    allowedRootCount?: number
  }
): void {
  logPlotStudioTiming(input.session.studioKind, 'tool.failure.detected', {
    sessionId: input.session.id,
    runId: input.run.id,
    assistantMessageId: input.assistantMessage.id,
    toolName: input.toolName,
    callId: input.toolCallId,
    failureStage: details.failureStage,
    failureKind: details.failureKind,
    permission: details.permission,
    errorName: details.errorName,
    error: details.error,
    stackPreview: details.stackPreview,
    targetPath: details.targetPath,
    resolvedPath: details.resolvedPath,
    workspaceRoot: details.workspaceRoot,
    allowedRoots: details.allowedRoots,
    allowedRootCount: details.allowedRootCount,
    inputSummary: summarizeToolInput(input.toolInput),
    runElapsedMs: readRunElapsedMs(input.run),
  }, 'warn')
}

function toWorkspacePathFailureDetails(error: unknown): {
  targetPath?: string
} {
  if (!(error instanceof WorkspacePathError)) {
    return {}
  }

  const targetPath = error.targetPath.trim()
  return {
    targetPath: pathLooksRelative(targetPath) ? targetPath : '[outside-workspace]'
  }
}

function pathLooksRelative(value: string): boolean {
  return Boolean(value) && !value.includes('\\0') && !/^[A-Za-z]:[\\/]/.test(value) && !value.startsWith('\\\\') && !value.startsWith('/')
}

function summarizeToolInput(input: Record<string, unknown>): string {
  try {
    const serialized = JSON.stringify(input)
    if (serialized.length <= 300) {
      return serialized
    }
    return `${serialized.slice(0, 297)}...`
  } catch {
    return '[unserializable tool input]'
  }
}

function summarizeStack(stack?: string): string | undefined {
  if (!stack?.trim()) {
    return undefined
  }
  const normalized = stack.trim()
  return normalized.length <= 600 ? normalized : `${normalized.slice(0, 597)}...`
}
