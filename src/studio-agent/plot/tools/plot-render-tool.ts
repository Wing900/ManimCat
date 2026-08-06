import { createStudioRender } from '../../domain/factories'
import type { StudioFileAttachment, StudioToolDefinition, StudioToolResult } from '../../domain/types'
import type { StudioRuntimeBackedToolContext } from '../../runtime/tools/tool-runtime-context'
import { isStudioRunCancelledError } from '../../runtime/execution/run-cancellation'
import {
  createUnconfiguredPlotRenderPort,
  type PlotRenderExecution,
  type PlotRenderPort
} from '../plot-render-port'
import { plotRenderToolParameters } from '../../tools/tool-parameters'
import { publishStudioRenderUpdated } from '../../render/render-events'
import { toWorkspaceRelativePath } from '../../tools/workspace-paths'

interface PlotRenderToolInput {
  concept: string
  code: string
}

export function createPlotStudioRenderTool(
  renderPort: PlotRenderPort = createUnconfiguredPlotRenderPort()
): StudioToolDefinition<PlotRenderToolInput> {
  return {
    name: 'render',
    parameters: plotRenderToolParameters,
    description: 'Execute matplotlib code and persist static plot outputs for preview.',
    category: 'render',
    permission: 'render',
    allowedAgents: ['builder'],
    allowedStudioKinds: ['plot'],
    requiresTask: true,
    execute: async (input, context) => executePlotRenderTool(input, context as StudioRuntimeBackedToolContext, renderPort)
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
  if (!context.renderStore) {
    throw new Error('Render store is unavailable')
  }

  const title = `Plot render: ${input.concept.slice(0, 80)}`
  const render = createStudioRender({
    ownerId: context.session.ownerId,
    sessionId: context.session.id,
    runId: context.run.id,
    kind: 'plot',
    title,
    concept: input.concept,
    outputMode: 'image',
    quality: 'medium',
    status: 'running',
    metadata: {
      studioKind: 'plot',
      outputMode: 'image'
    },
  })
  render.metadata = { ...(render.metadata ?? {}), renderId: render.id }
  const createdRender = await context.renderStore.create(render)
  publishStudioRenderUpdated(context.eventBus, createdRender)

  context.setToolMetadata?.({
    title,
    metadata: {
      renderId: render.id,
      studioKind: 'plot'
    }
  })

  try {
    const execution = await renderPort.execute({
      workspaceDirectory: context.session.directory,
      renderId: render.id,
      code: input.code,
      signal: context.abortSignal,
    })
    const attachments = buildAttachments(execution.imageDataUris, execution.imagePaths)
    const completed = await context.renderStore.update(context.session.ownerId, render.id, {
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
        imageCount: execution.imageDataUris.length,
        scriptPath: completed.metadata?.scriptPath,
        imagePaths: completed.metadata?.imagePaths,
      },
    }
  } catch (error) {
    const failedRender = await context.renderStore.update(context.session.ownerId, render.id, {
      status: isStudioRunCancelledError(error) ? 'cancelled' : 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    if (failedRender) {
      publishStudioRenderUpdated(context.eventBus, failedRender)
    }
    throw error
  }
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
