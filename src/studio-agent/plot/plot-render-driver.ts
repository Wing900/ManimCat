import type { StudioFileAttachment } from '../domain/types'
import type { StudioRenderDriver, StudioRenderExecutionInput, StudioRenderExecutionResult } from '../render/studio-render-driver'
import { toWorkspaceRelativePath } from '../tools/workspace-paths'
import type { PlotRenderPort } from './plot-render-port'

/**
 * Matplotlib render driver: runs the script inline, respects the AbortSignal, and completes
 * immediately. There is no queue to cancel and no job to reconcile — the render is terminal
 * by the time `execute` returns.
 */
export function createMatplotlibRenderDriver(options: {
  renderPort: PlotRenderPort
}): StudioRenderDriver {
  const { renderPort } = options

  return {
    kind: 'matplotlib',
    async execute(input: StudioRenderExecutionInput): Promise<StudioRenderExecutionResult> {
      const execution = await renderPort.execute({
        workspaceDirectory: input.workspaceDirectory,
        renderId: input.render.id,
        code: input.code,
        signal: input.signal,
      })
      const attachments = buildAttachments(execution.imageDataUris, execution.imagePaths)
      return {
        status: 'completed',
        attachments,
        metadata: {
          imageCount: execution.imageDataUris.length,
          scriptPath: toWorkspaceRelativePath(input.workspaceDirectory, execution.scriptPath).replace(/\\/g, '/'),
          imagePaths: execution.imagePaths.map((path) =>
            toWorkspaceRelativePath(input.workspaceDirectory, path).replace(/\\/g, '/')
          ),
        },
      }
    },
  }
}

function buildAttachments(imageDataUris: string[], imagePaths: string[]): StudioFileAttachment[] {
  return imageDataUris.map((path, index) => ({
    kind: 'file',
    path,
    name: fileNameFromPath(imagePaths[index]) || `plot_${index + 1}.png`,
    mimeType: 'image/png',
  }))
}

function fileNameFromPath(path?: string): string {
  if (!path) {
    return ''
  }
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}