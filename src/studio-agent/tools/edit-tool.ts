import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { truncateToolText, toWorkspaceRelativePath } from './workspace-paths'
import { replaceInWorkspaceFile } from './workspace-edits'

interface EditToolInput {
  path?: string
  file?: string
  search?: string
  replace?: string
  replaceAll?: boolean
}

export function createStudioEditTool(): StudioToolDefinition<EditToolInput> {
  return {
    name: 'edit',
    description: 'Replace text in a workspace file.',
    category: 'edit',
    permission: 'edit',
    allowedAgents: ['builder'],
    requiresTask: false,
    execute: async (input, context) => executeEditTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeEditTool(input: EditToolInput, context: StudioRuntimeBackedToolContext): Promise<StudioToolResult> {
  const target = input.path ?? input.file
  if (!target || typeof input.search !== 'string' || typeof input.replace !== 'string') {
    throw new Error('Edit tool requires "path", "search", and "replace"')
  }

  const result = await replaceInWorkspaceFile({
    baseDirectory: context.session.directory,
    targetPath: target,
    search: input.search,
    replace: input.replace,
    replaceAll: input.replaceAll
  })

  const relativePath = toWorkspaceRelativePath(context.session.directory, result.absolutePath).replace(/\\/g, '/')
  const output = truncateToolText(result.content)

  return {
    title: `Edited ${relativePath}`,
    output: output.text,
    metadata: {
      path: relativePath,
      absolutePath: result.absolutePath,
      replacements: result.replacements,
      truncated: output.truncated
    }
  }
}
