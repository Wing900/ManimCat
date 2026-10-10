import { createStudioRender } from '../../domain/factories'
import type { StudioFileAttachment, StudioToolDefinition, StudioToolResult } from '../../domain/types'
import type { StudioRuntimeBackedToolContext } from '../../runtime/tools/tool-runtime-context'
import { throwIfStudioRunCancelled } from '../../runtime/execution/run-cancellation'
import type { PlotRenderExecution, PlotRenderPort } from '../plot-render-port'
import { plotRenderToolParameters } from '../../tools/tool-parameters'
import { publishStudioRenderUpdated } from '../../render/render-events'
import {
  executeStudioRenderLifecycle,
  studioRenderFailureMessage,
  studioRenderFailureStatus
} from '../../render/render-lifecycle'
import { toWorkspaceRelativePath } from '../../tools/workspace-paths'

interface PlotRenderToolInput {
  concept: string
  code: string
}

export function createPlotStudioRenderTool(
  renderPort: PlotRenderPort
): StudioToolDefinition<PlotRenderToolInput> {
  return {
    name: 'render',
    parameters: plotRenderToolParameters,
    description: 'Execute the matplotlib source and persist the plot images.',
    allowedAgents: ['builder'],
    allowedStudioKinds: ['matplotlib'],
    execute: async (input, context) =>
      executePlotRenderTool(input, context as StudioRuntimeBackedToolContext, renderPort)
  }
}

async function executePlotRenderTool(
  input: PlotRenderToolInput,
  context: StudioRuntimeBackedToolContext,
  renderPort: PlotRenderPort
): Promise<StudioToolResult> {
  if (!input.concept?.trim() || !input.code?.trim()) {
    throw new Error('Render tool requires non-empty "concept" and "code"')
  }

  const title = `Plot render: ${input.concept.slice(0, 80)}`

  return executeStudioRenderLifecycle({
    context,
    createRender: () => {
      const render = createStudioRender({
        ownerId: context.session.ownerId,
        sessionId: context.session.id,
        runId: context.run.id,
        // The Run is the authoritative scope source; a Legacy Run leaves the key absent.
        sceneId: context.run.sceneId,
        kind: 'matplotlib',
        title,
        concept: input.concept,
        outputMode: 'image',
        quality: 'medium',
        status: 'running',
        metadata: {
          studioKind: 'matplotlib',
          outputMode: 'image'
        },
      })
      render.metadata = { ...(render.metadata ?? {}), renderId: render.id }
      return render
    },
    execute: async (render, renderStore) => {
      context.setToolMetadata?.({
        title,
        metadata: {
          renderId: render.id,
          studioKind: 'matplotlib'
        }
      })

      const execution = await renderPort.execute({
        workspaceDirectory: context.session.directory,
        renderId: render.id,
        code: input.code,
        signal: context.abortSignal,
      })
      throwIfStudioRunCancelled(context.abortSignal)
      const attachments = buildAttachments(execution.imageDataUris, execution.imagePaths)
      const completed = await renderStore.update(context.session.ownerId, render.id, {
        status: 'completed',
        attachments,
        metadata: {
          ...(render.metadata ?? {}),
          imageCount: execution.imageDataUris.length,
          scriptPath: toWorkspaceRelativePath(context.session.directory, execution.scriptPath).replace(/\\/g, '/'),
          imagePaths: execution.imagePaths.map((imagePath) => toWorkspaceRelativePath(context.session.directory, imagePath).replace(/\\/g, '/')),
        },
      })
      if (!completed) {
        throw new Error('Render record disappeared before completion')
      }
      publishStudioRenderUpdated(context.eventBus, completed)

      return {
        title,
        output: `plot_render_id: ${render.id}`,
        attachments,
        metadata: {
          renderId: render.id,
          phase: 'render',
          diagnosticCount: 0,
          imageCount: execution.imageDataUris.length,
          scriptPath: completed.metadata?.scriptPath,
          imagePaths: completed.metadata?.imagePaths,
        },
      }
    },
    markFailed: async (render, renderStore, error) => {
      const failedRender = await renderStore.update(context.session.ownerId, render.id, {
        status: studioRenderFailureStatus(error),
        error: studioRenderFailureMessage(error),
      })
      if (failedRender) {
        publishStudioRenderUpdated(context.eventBus, failedRender)
      }
    }
  })
}

function buildAttachments(imageDataUris: string[], imagePaths: string[]): StudioFileAttachment[] {
  return imageDataUris.map((path, index) => ({
    kind: 'file',
    path,
    name: fileNameFromPath(imagePaths[index]) || `plot_${index + 1}.png`,
    mimeType: 'image/png'
  }))
}

function fileNameFromPath(path?: string): string {
  if (!path) {
    return ''
  }

  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}
