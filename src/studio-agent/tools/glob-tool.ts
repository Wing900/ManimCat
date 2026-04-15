import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import {
  toWorkspaceRelativePath,
  truncateToolText,
  walkWorkspaceFiles,
  wildcardToRegExp
} from './workspace-paths'

interface GlobToolInput {
  pattern?: string
  path?: string
}

export function createStudioGlobTool(): StudioToolDefinition<GlobToolInput> {
  return {
    name: 'glob',
    description: 'Find files by glob pattern.',
    category: 'safe-read',
    permission: 'glob',
    allowedAgents: ['builder', 'reviewer', 'designer'],
    requiresTask: false,
    execute: async (input, context) => executeGlobTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeGlobTool(
  input: GlobToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  if (!input.pattern) {
    throw new Error('Glob tool requires "pattern"')
  }

  const files = await walkWorkspaceFiles(context.session.directory, input.path ?? '.')
  const matcher = wildcardToRegExp(input.pattern)
  const matches = files.filter((file) => matcher.test(file))
  const output = truncateToolText(matches.join('\n') || '(no matches)')

  return {
    title: `Glob ${input.pattern}`,
    output: output.text,
    metadata: {
      pattern: input.pattern,
      path: input.path ?? '.',
      matchCount: matches.length,
      truncated: output.truncated,
      basePath: toWorkspaceRelativePath(context.session.directory, context.session.directory)
    }
  }
}
