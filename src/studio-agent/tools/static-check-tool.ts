import { readWorkspaceFile, toWorkspaceRelativePath, truncateToolText } from './workspace-paths'
import type { StudioKind, StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import type { OutputMode } from '../../types'
import { createUnconfiguredStudioStaticCheckPort } from '../static-check/create-default-studio-static-check-port'
import type { StudioStaticCheckPort } from '../static-check/studio-static-check-types'
import { staticCheckToolParameters } from './tool-parameters'

interface StaticCheckToolInput {
  path?: string
  file?: string
  outputMode?: OutputMode
}

/**
 * The Tool is domain-neutral: the Studio kind is derived from the trusted session and
 * routed by the injected Port. Tool input never selects a Studio kind or an Adapter.
 *
 * The default Port is explicitly unconfigured and exists only for isolated composition;
 * production injects one shared Port through the registry.
 */
export function createStudioStaticCheckTool(
  staticCheckPort: StudioStaticCheckPort = createUnconfiguredStudioStaticCheckPort()
): StudioToolDefinition<StaticCheckToolInput> {
  return {
    name: 'static-check',
    parameters: staticCheckToolParameters,
    description: 'Check the current Studio Python source.',
    allowedAgents: ['builder'],
    execute: async (input, context) => executeStaticCheckTool(
      input,
      context as StudioRuntimeBackedToolContext,
      staticCheckPort
    )
  }
}

async function executeStaticCheckTool(
  input: StaticCheckToolInput,
  context: StudioRuntimeBackedToolContext,
  staticCheckPort: StudioStaticCheckPort
): Promise<StudioToolResult> {
  const target = input.path ?? input.file
  if (!target) {
    throw new Error('Static-check tool requires "path" or "file"')
  }

  const kind: StudioKind = context.session.studioKind ?? 'manim'
  const file = await readWorkspaceFile(context.session.directory, target)
  const result = await staticCheckPort.check({
    kind,
    code: file.content,
    outputMode: input.outputMode
  })
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
      kind: result.kind,
      outputMode: result.outputMode,
      diagnosticCount: result.diagnostics.length,
      diagnostics: result.diagnostics,
      truncated: output.truncated
    }
  }
}
