import { readWorkspaceFile, toWorkspaceRelativePath, truncateToolText } from './workspace-paths'
import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { runStaticChecks } from '../../services/static-guard/checker'
import type { OutputMode } from '../../types'

interface StaticCheckToolInput {
  path?: string
  file?: string
  outputMode?: OutputMode
}

export function createStudioStaticCheckTool(): StudioToolDefinition<StaticCheckToolInput> {
  return {
    name: 'static-check',
    description: 'Run static checks for Python or Manim code.',
    category: 'review',
    permission: 'static-check',
    allowedAgents: ['builder', 'reviewer'],
    requiresTask: false,
    execute: async (input, context) => executeStaticCheckTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeStaticCheckTool(
  input: StaticCheckToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  const target = input.path ?? input.file
  if (!target) {
    throw new Error('Static-check tool requires "path" or "file"')
  }

  const file = await readWorkspaceFile(context.session.directory, target)
  const outputMode = input.outputMode ?? 'video'
  const result = await runStaticChecks(file.content, outputMode)
  const relativePath = toWorkspaceRelativePath(context.session.directory, file.absolutePath).replace(/\\/g, '/')
  const summary = result.diagnostics.length
    ? result.diagnostics.map((item) => `${item.tool}:${item.line}${item.column ? `:${item.column}` : ''} ${item.message}`).join('\n')
    : 'No static diagnostics.'
  const output = truncateToolText(summary)

  return {
    title: `Static check ${relativePath}`,
    output: output.text,
    metadata: {
      path: relativePath,
      absolutePath: file.absolutePath,
      outputMode,
      diagnosticCount: result.diagnostics.length,
      diagnostics: result.diagnostics,
      truncated: output.truncated
    }
  }
}
