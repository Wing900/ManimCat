import { createStudioRender } from '../../domain/factories'
import type { StudioFileAttachment, StudioKind, StudioToolDefinition, StudioToolResult } from '../../domain/types'
import type { StudioRuntimeBackedToolContext } from '../../runtime/tools/tool-runtime-context'
import { isStudioRunCancelledError, throwIfStudioRunCancelled } from '../../runtime/execution/run-cancellation'
import {
  createUnconfiguredPlotRenderPort,
  type PlotRenderExecution,
  type PlotRenderPort
} from '../plot-render-port'
import { plotRenderToolParameters } from '../../tools/tool-parameters'
import { createUnconfiguredStudioStaticCheckPort } from '../../static-check/create-default-studio-static-check-port'
import type { StudioStaticCheckPort } from '../../static-check/studio-static-check-types'
import { runStudioStaticCheckGate } from '../../static-check/static-check-gate'
import { publishStudioRenderUpdated } from '../../render/render-events'
import { toWorkspaceRelativePath } from '../../tools/workspace-paths'

interface PlotRenderToolInput {
  concept: string
  code: string
}

export function createPlotStudioRenderTool(
  renderPort: PlotRenderPort = createUnconfiguredPlotRenderPort(),
  staticCheckPort: StudioStaticCheckPort = createUnconfiguredStudioStaticCheckPort()
): StudioToolDefinition<PlotRenderToolInput> {
  return {
    name: 'render',
    parameters: plotRenderToolParameters,
    description:
      'Check the matplotlib source, then execute it and persist the plot images. If the check fails nothing is executed and the diagnostics come back.',
    allowedAgents: ['builder'],
    allowedStudioKinds: ['plot'],
    execute: async (input, context) =>
      executePlotRenderTool(input, context as StudioRuntimeBackedToolContext, renderPort, staticCheckPort)
  }
}

async function executePlotRenderTool(
  input: PlotRenderToolInput,
  context: StudioRuntimeBackedToolContext,
  renderPort: PlotRenderPort,
  staticCheckPort: StudioStaticCheckPort
): Promise<StudioToolResult> {
  if (!input.concept?.trim() || !input.code?.trim()) {
    throw new Error('Render tool requires non-empty "concept" and "code"')
  }
  if (!context.renderStore) {
    throw new Error('Render store is unavailable')
  }

  const kind: StudioKind = context.session.studioKind ?? 'plot'

  // Check first: nothing is reserved and no plot image is produced when the source is broken.
  const check = await runStudioStaticCheckGate({
    port: staticCheckPort,
    kind,
    code: input.code,
    outputMode: 'image',
    signal: context.abortSignal
  })
  throwIfStudioRunCancelled(context.abortSignal)
  if (!check.passed) {
    return {
      title: `Static check: ${input.concept.slice(0, 80)}`,
      output: check.output,
      metadata: {
        phase: 'static-check',
        kind,
        outputMode: 'image',
        diagnosticCount: check.result.diagnostics.length,
        diagnostics: check.result.diagnostics
      }
    }
  }

  const title = `Plot render: ${input.concept.slice(0, 80)}`
  const render = createStudioRender({
    ownerId: context.session.ownerId,
    sessionId: context.session.id,
    runId: context.run.id,
    // The Run is the authoritative scope source; a Legacy Run leaves the key absent.
    sceneId: context.run.sceneId,
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
    throwIfStudioRunCancelled(context.abortSignal)
    const execution = await renderPort.execute({
      workspaceDirectory: context.session.directory,
      renderId: render.id,
      code: input.code,
      signal: context.abortSignal,
    })
    throwIfStudioRunCancelled(context.abortSignal)
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
        phase: 'render',
        diagnosticCount: 0,
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
