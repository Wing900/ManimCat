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
import { evaluatePermission } from '../../permissions/policy'
import type { StudioToolRegistry } from '../../tools/registry'
import type {
  StudioResolvedSkill,
  StudioRuntimeBackedToolContext,
  StudioSkillDiscoveryEntry,
  StudioSkillUsageSummary,
  StudioSubagentRunRequest,
  StudioSubagentRunResult
} from './tool-runtime-context'
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
  runSubagent?: (input: StudioSubagentRunRequest) => Promise<StudioSubagentRunResult>
  resolveSkill?: (name: string, session: StudioSession) => Promise<StudioResolvedSkill>
  listSkills?: (session: StudioSession) => Promise<StudioSkillDiscoveryEntry[]>
  listSkillSummaries?: (session: StudioSession) => Promise<StudioSkillUsageSummary[]>
  recordSkillUsage?: StudioRuntimeBackedToolContext['recordSkillUsage']
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

  const permissionAction = evaluatePermission(
    input.session.permissionRules,
    tool.permission,
    resolvePermissionPattern(input.toolInput)
  )

  if (permissionAction === 'deny') {
    logDetectedToolFailure(input, {
      error: `Permission denied for tool "${input.toolName}"`,
      failureStage: 'permission',
      failureKind: 'permission_denied',
      permission: tool.permission,
    })
    yield createToolErrorEvent(input.toolCallId, `Permission denied for tool "${input.toolName}"`, {
      permission: tool.permission,
      failureStage: 'permission',
      failureKind: 'permission_denied',
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
    sessionStore: input.options.sessionStore,
    runSubagent: input.options.runSubagent,
    resolveSkill: input.options.resolveSkill,
    listSkills: input.options.listSkills,
    listSkillSummaries: input.options.listSkillSummaries,
    recordSkillUsage: input.options.recordSkillUsage
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
    allowedSkillRoots?: string[]
    loadedSkillPartCount?: number
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
    allowedSkillRoots: details.allowedSkillRoots,
    loadedSkillPartCount: details.loadedSkillPartCount,
    inputSummary: summarizeToolInput(input.toolInput),
    runElapsedMs: readRunElapsedMs(input.run),
  }, 'warn')
}

function toWorkspacePathFailureDetails(error: unknown): {
  targetPath?: string
  resolvedPath?: string
  workspaceRoot?: string
  allowedRoots?: string[]
  allowedRootCount?: number
  allowedSkillRoots?: string[]
  loadedSkillPartCount?: number
} {
  if (!(error instanceof WorkspacePathError)) {
    return {}
  }

  const metadata = error as WorkspacePathError & {
    allowedSkillRoots?: unknown
    loadedSkillPartCount?: unknown
  }

  return {
    targetPath: error.targetPath,
    resolvedPath: error.resolvedPath,
    workspaceRoot: error.workspaceRoot,
    allowedRoots: error.allowedRoots,
    allowedRootCount: error.allowedRoots.length,
    allowedSkillRoots: Array.isArray(metadata.allowedSkillRoots)
      ? metadata.allowedSkillRoots.filter((value): value is string => typeof value === 'string')
      : undefined,
    loadedSkillPartCount: typeof metadata.loadedSkillPartCount === 'number'
      ? metadata.loadedSkillPartCount
      : undefined,
  }
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

function resolvePermissionPattern(input: Record<string, unknown>): string {
  const candidate = input as {
    file?: unknown
    path?: unknown
    pattern?: unknown
    directory?: unknown
    name?: unknown
    subagent_type?: unknown
  }
  if (typeof candidate.file === 'string' && candidate.file) {
    return candidate.file
  }
  if (typeof candidate.path === 'string' && candidate.path) {
    return candidate.path
  }
  if (typeof candidate.directory === 'string' && candidate.directory) {
    return candidate.directory
  }
  if (typeof candidate.pattern === 'string' && candidate.pattern) {
    return candidate.pattern
  }
  if (typeof candidate.name === 'string' && candidate.name) {
    return candidate.name
  }
  if (typeof candidate.subagent_type === 'string' && candidate.subagent_type) {
    return candidate.subagent_type
  }
  return '*'
}




