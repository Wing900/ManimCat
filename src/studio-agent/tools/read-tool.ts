import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { readWorkspaceFile, toWorkspaceRelativePath, truncateToolText } from './workspace-paths'

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

  const file = await readWorkspaceFile(context.session.directory, target)
  const relativePath = toWorkspaceRelativePath(context.session.directory, file.absolutePath).replace(/\\/g, '/')
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
