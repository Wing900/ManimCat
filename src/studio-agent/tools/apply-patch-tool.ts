import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import { truncateToolText, toWorkspaceRelativePath } from './workspace-paths'
import { applyWorkspacePatch } from './workspace-edits'

interface ApplyPatchToolInput {
  path?: string
  file?: string
  patches?: Array<{ search: string; replace: string; replaceAll?: boolean }>
}

export function createStudioApplyPatchTool(): StudioToolDefinition<ApplyPatchToolInput> {
  return {
    name: 'apply_patch',
    description: 'Apply structured search/replace patches to a workspace file.',
    category: 'edit',
    permission: 'apply_patch',
    allowedAgents: ['builder'],
    requiresTask: false,
    execute: async (input, context) => executeApplyPatchTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeApplyPatchTool(
  input: ApplyPatchToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  const target = input.path ?? input.file
  if (!target || !Array.isArray(input.patches) || input.patches.length === 0) {
    throw new Error('Apply_patch tool requires "path" and non-empty "patches"')
  }

  const result = await applyWorkspacePatch({
    baseDirectory: context.session.directory,
    targetPath: target,
    patches: input.patches
  })

  const relativePath = toWorkspaceRelativePath(context.session.directory, result.absolutePath).replace(/\\/g, '/')
  const output = truncateToolText(result.content)

  return {
    title: `Patched ${relativePath}`,
    output: output.text,
    metadata: {
      path: relativePath,
      absolutePath: result.absolutePath,
      replacements: result.replacements,
      patchCount: input.patches.length,
      truncated: output.truncated
    }
  }
}
