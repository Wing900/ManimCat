import type {
  StudioAssistantMessage,
  StudioPermissionRequest,
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
import type { StudioPermissionService } from '../../permissions/permission-service'
import type { StudioToolRegistry } from '../../tools/registry'
import { createPermissionAskBridge, StudioPermissionRejectedError } from './permission-bridge'
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
  permissionService?: StudioPermissionService
  sessionStore?: StudioSessionStore
  taskStore?: StudioTaskStore
  workStore?: StudioWorkStore
  workResultStore?: StudioWorkResultStore
  askForConfirmation?: (request: StudioPermissionRequest) => Promise<'once' | 'always' | 'reject'>
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
    yield createToolErrorEvent(input.toolCallId, `Tool not found: ${input.toolName}`)
    return
  }

  const permissionAction = evaluatePermission(
    input.session.permissionRules,
    tool.permission,
    resolvePermissionPattern(input.toolInput)
  )

  if (permissionAction === 'deny') {
    yield createToolErrorEvent(input.toolCallId, `Permission denied for tool "${input.toolName}"`, {
      permission: tool.permission
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
    yield createToolErrorEvent(
      input.toolCallId,
      error instanceof Error ? error.message : String(error),
      error instanceof StudioPermissionRejectedError ? { rejected: true } : undefined
    )
  }
}

async function executeTool(input: {
  tool: StudioToolDefinition
  options: StudioToolCallExecutionOptions
}) {
  const ask = createPermissionAskBridge({
    permissionService: input.options.permissionService,
    fallback: input.options.askForConfirmation
      ? async (request) =>
          input.options.askForConfirmation?.({
            id: `fallback_${input.options.toolCallId}`,
            sessionID: input.options.session.id,
            permission: request.permission,
            patterns: request.patterns,
            metadata: request.metadata,
            always: request.always ?? request.patterns,
            tool: {
              messageID: input.options.assistantMessage.id,
              callID: input.options.toolCallId
            }
          }) ?? 'reject'
      : undefined,
    session: input.options.session,
    run: input.options.run,
    messageId: input.options.assistantMessage.id,
    toolName: input.options.toolName,
    callId: input.options.toolCallId
  })

  const toolContext = {
    projectId: input.options.projectId,
    session: input.options.session,
    run: input.options.run,
    abortSignal: input.options.abortSignal,
    assistantMessage: input.options.assistantMessage,
    eventBus: input.options.eventBus,
    taskStore: input.options.taskStore,
    workStore: input.options.workStore,
    workResultStore: input.options.workResultStore,
    askForConfirmation: async (request: StudioPermissionRequest) => {
      if (!input.options.permissionService) {
        return input.options.askForConfirmation?.(request) ?? 'reject'
      }
      return input.options.permissionService.ask(request)
    },
    setToolMetadata: (metadata: { title?: string; metadata?: Record<string, unknown> }) => {
      input.options.setToolMetadata(input.options.toolCallId, metadata)
    },
    sessionStore: input.options.sessionStore,
    ask,
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

function resolvePermissionPattern(input: Record<string, unknown>): string {
  const candidate = input as { file?: unknown; path?: unknown; pattern?: unknown; directory?: unknown }
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
  return '*'
}




