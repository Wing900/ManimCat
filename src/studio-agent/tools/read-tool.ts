import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { readWorkspaceFile, toWorkspaceRelativePath, truncateToolText, WorkspacePathError } from './workspace-paths'

interface ReadToolInput {
  path?: string
  file?: string
}

export function createStudioReadTool(): StudioToolDefinition<ReadToolInput> {
  return {
    name: 'read',
    description: 'Read a file from the current workspace.',
    category: 'safe-read',
    permission: 'read',
    allowedAgents: ['builder', 'reviewer', 'designer'],
    requiresTask: false,
    execute: async (input, context) => executeReadTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeReadTool(
  input: ReadToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  const target = input.path ?? input.file
  if (!target) {
    throw new Error('Read tool requires "path" or "file"')
  }

  const skillAccess = await getLoadedSkillAccess(context)
  let file
  try {
    file = await readWorkspaceFile(context.session.directory, target, { allowedRoots: skillAccess.directories })
  } catch (error) {
    throw withSkillAccessDetails(error, skillAccess)
  }
  const relativePath = formatReadablePath(context.session.directory, file.absolutePath, skillAccess.directories)
  const output = truncateToolText(file.content)

  return {
    title: `Read ${relativePath}`,
    output: output.text,
    metadata: {
      path: relativePath,
      absolutePath: file.absolutePath,
      truncated: output.truncated
    }
  }
}

async function getLoadedSkillAccess(context: StudioRuntimeBackedToolContext): Promise<{
  directories: string[]
  loadedSkillPartCount: number
}> {
  if (context.listSkills) {
    const entries = await context.listSkills(context.session)
    return {
      directories: [...new Set(entries.map((entry) => entry.directory))],
      loadedSkillPartCount: entries.length
    }
  }

  if (!context.partStore) {
    return {
      directories: [],
      loadedSkillPartCount: 0
    }
  }

  const directories = new Set<string>()
  let loadedSkillPartCount = 0
  const messageIds = await listRelevantAssistantMessageIds(context)

  for (const messageId of messageIds) {
    const parts = await context.partStore.listByMessageId(messageId)
    for (const part of parts) {
      if (part.type !== 'tool' || part.tool !== 'skill') {
        continue
      }

      loadedSkillPartCount += 1
      const directory = part.metadata?.directory
      if (typeof directory === 'string' && directory.trim()) {
        directories.add(directory)
      }
    }
  }

  return {
    directories: [...directories],
    loadedSkillPartCount
  }
}

async function listRelevantAssistantMessageIds(context: StudioRuntimeBackedToolContext): Promise<string[]> {
  if (!context.messageStore) {
    return [context.assistantMessage.id]
  }

  const messages = await context.messageStore.listBySessionId(context.session.id)
  const relevantIds = messages
    .filter((message) => message.role === 'assistant')
    .filter((message) => message.id === context.assistantMessage.id || readMessageRunId(message.metadata) === context.run.id)
    .map((message) => message.id)

  return relevantIds.length > 0 ? relevantIds : [context.assistantMessage.id]
}

function readMessageRunId(metadata: Record<string, unknown> | undefined): string | undefined {
  const runId = metadata?.runId
  return typeof runId === 'string' && runId.trim() ? runId : undefined
}

function formatReadablePath(baseDirectory: string, absolutePath: string, allowedRoots: string[]): string {
  const workspaceRelative = toWorkspaceRelativePath(baseDirectory, absolutePath).replace(/\\/g, '/')
  if (workspaceRelative !== '.' && !workspaceRelative.startsWith('..')) {
    return workspaceRelative
  }

  for (const root of allowedRoots) {
    const relative = toWorkspaceRelativePath(root, absolutePath).replace(/\\/g, '/')
    if (relative !== '.' && !relative.startsWith('..')) {
      return relative
    }
  }

  return absolutePath.replace(/\\/g, '/')
}

function withSkillAccessDetails(
  error: unknown,
  skillAccess: { directories: string[]; loadedSkillPartCount: number }
): unknown {
  if (!(error instanceof WorkspacePathError)) {
    return error
  }

  return Object.assign(error, {
    loadedSkillPartCount: skillAccess.loadedSkillPartCount,
    allowedSkillRoots: skillAccess.directories
  })
}
