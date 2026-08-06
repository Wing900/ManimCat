import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { toWorkspaceRelativePath } from './workspace-paths'
import { writeWorkspaceFile } from './workspace-edits'
import { writeToolParameters } from './tool-parameters'

interface WriteToolInput {
  path?: string
  file?: string
  content?: string
}

export function createStudioWriteTool(): StudioToolDefinition<WriteToolInput> {
  return {
    name: 'write',
    parameters: writeToolParameters,
    description: 'Write a file in the current workspace.',
    allowedAgents: ['builder'],
    execute: async (input, context) => executeWriteTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeWriteTool(input: WriteToolInput, context: StudioRuntimeBackedToolContext): Promise<StudioToolResult> {
  const target = input.path ?? input.file
  if (!target) {
    throw new Error('Write tool requires "path" or "file"')
  }

  const result = await writeWorkspaceFile(context.session.directory, target, input.content ?? '')
  const relativePath = toWorkspaceRelativePath(context.session.directory, result.absolutePath).replace(/\\/g, '/')

  return {
    title: `Wrote ${relativePath}`,
    output: `File written successfully: ${relativePath}`,
    metadata: {
      path: relativePath,
      bytes: result.bytes
    }
  }
}
