import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import {
  readWorkspaceFile,
  truncateToolText,
  walkWorkspaceFiles
} from './workspace-paths'

interface GrepToolInput {
  query?: string
  pattern?: string
  path?: string
}

export function createStudioGrepTool(): StudioToolDefinition<GrepToolInput> {
  return {
    name: 'grep',
    description: 'Search for text in the workspace.',
    category: 'safe-read',
    permission: 'grep',
    allowedAgents: ['builder', 'reviewer', 'designer'],
    requiresTask: false,
    execute: async (input, context) => executeGrepTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeGrepTool(
  input: GrepToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  const query = input.query ?? input.pattern
  if (!query) {
    throw new Error('Grep tool requires "query" or "pattern"')
  }

  const files = await walkWorkspaceFiles(context.session.directory, input.path ?? '.')
  const matches: string[] = []

  for (const file of files) {
    if (matches.length >= 200) {
      break
    }

    try {
      const content = await readWorkspaceFile(context.session.directory, file)
      const lines = content.content.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].includes(query)) {
          continue
        }

        matches.push(`${file}:${index + 1}: ${lines[index].trim()}`)
        if (matches.length >= 200) {
          break
        }
      }
    } catch {
      continue
    }
  }

  const output = truncateToolText(matches.join('\n') || '(no matches)')

  return {
    title: `Grep ${query}`,
    output: output.text,
    metadata: {
      query,
      path: input.path ?? '.',
      matchCount: matches.length,
      truncated: output.truncated
    }
  }
}
