import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { listWorkspaceDirectory, toWorkspaceRelativePath, truncateToolText } from './workspace-paths'

interface LsToolInput {
  path?: string
  directory?: string
}

export function createStudioLsTool(): StudioToolDefinition<LsToolInput> {
  return {
    name: 'ls',
    description: 'List directory contents.',
    category: 'safe-read',
    permission: 'ls',
    allowedAgents: ['builder', 'reviewer', 'designer'],
    requiresTask: false,
    execute: async (input, context) => executeLsTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeLsTool(
  input: LsToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  const listing = await listWorkspaceDirectory(context.session.directory, input.path ?? input.directory ?? '.')
  const relativePath = toWorkspaceRelativePath(context.session.directory, listing.absolutePath).replace(/\\/g, '/')
  const output = truncateToolText(listing.entries.join('\n') || '(empty directory)')

  return {
    title: `List ${relativePath}`,
    output: output.text,
    metadata: {
      path: relativePath,
      absolutePath: listing.absolutePath,
      entryCount: listing.entries.length,
      truncated: output.truncated
    }
  }
}
