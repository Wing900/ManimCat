import { randomUUID } from 'node:crypto'
import { createStudioWorkResult } from '../../domain/factories'
import type { StudioFileAttachment, StudioToolDefinition, StudioToolResult, StudioWorkResult } from '../../domain/types'
import type { StudioRuntimeBackedToolContext } from '../../runtime/tools/tool-runtime-context'
import { createWorkAndTask, publishWorkUpdated, updateTaskAndWork } from '../../works/work-lifecycle'
import { isStudioRunCancelledError } from '../../runtime/execution/run-cancellation'
import {
  createUnconfiguredPlotRenderPort,
  type PlotRenderExecution,
  type PlotRenderPort
} from '../plot-render-port'
import { plotRenderToolParameters } from '../../tools/tool-parameters'
import { createStudioRender } from '../../domain/factories'
import { toWorkspaceRelativePath } from '../../tools/workspace-paths'
import { publishStudioRenderUpdated } from '../../render/render-events'

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

  let renderId = `plot_${randomUUID()}`
  const title = `Plot render: ${input.concept.slice(0, 80)}`
  const lifecycleMetadata = {
    renderId,
    concept: input.concept,
    studioKind: 'plot',
    outputMode: 'image'
  }

  const studioRender = context.renderStore
    ? createStudioRender({
        ownerId: context.session.ownerId,
        sessionId: context.session.id,
        runId: context.run.id,
        kind: 'plot',
        title,
        concept: input.concept,
        outputMode: 'image',
        quality: 'medium',
        status: 'running',
        metadata: lifecycleMetadata,
      })
    : undefined
  if (studioRender && context.renderStore) {
    renderId = studioRender.id
    studioRender.metadata = { ...(studioRender.metadata ?? {}), renderId }
    lifecycleMetadata.renderId = renderId
    const createdRender = await context.renderStore.create(studioRender)
    publishStudioRenderUpdated(context.eventBus, createdRender)
  }

  const { work, task } = context.renderStore
    ? { work: undefined, task: undefined }
    : await createWorkAndTask({
        context,
        work: {
          sessionId: context.session.id,
          runId: context.run.id,
          type: 'plot',
          title,
          status: 'running',
          metadata: lifecycleMetadata
        },
        task: {
          sessionId: context.session.id,
          runId: context.run.id,
          type: 'render',
          status: 'running',
          title,
          detail: input.concept,
          metadata: lifecycleMetadata
        },
        workMetadata: lifecycleMetadata
      })

  context.setToolMetadata?.({
    title,
      metadata: {
        renderId,
        studioKind: 'plot'
      }
  })

  try {
    const execution = await renderPort.execute({
      workspaceDirectory: context.session.directory,
      renderId,
      code: input.code,
      signal: context.abortSignal,
    })

    if (studioRender && context.renderStore) {
      const attachments = buildAttachments(execution.imageDataUris, execution.imagePaths)
      const completed = await context.renderStore.update(context.session.ownerId, studioRender.id, {
        status: 'completed',
        attachments,
        metadata: {
          ...lifecycleMetadata,
          imageCount: execution.imageDataUris.length,
          scriptPath: toWorkspaceRelativePath(context.session.directory, execution.scriptPath).replace(/\\/g, '/'),
          imagePaths: execution.imagePaths.map((imagePath) => toWorkspaceRelativePath(context.session.directory, imagePath).replace(/\\/g, '/')),
        },
      })
      if (completed) {
        publishStudioRenderUpdated(context.eventBus, completed)
      }
      return {
        title,
        output: `plot_render_id: ${studioRender.id}`,
        attachments,
        metadata: {
          renderId: studioRender.id,
          imageCount: execution.imageDataUris.length,
          scriptPath: completed?.metadata?.scriptPath,
          imagePaths: completed?.metadata?.imagePaths,
        },
      }
    }

    const workResult = await persistWorkResult({
      context,
      workId: work?.id,
      taskId: task?.id,
      renderId,
      code: input.code,
      codeLanguage: 'python',
      execution,
    })

    const completed = await updateTaskAndWork({
      context,
      task,
      work,
      taskPatch: {
        status: 'completed',
        metadata: {
          ...(task?.metadata ?? {}),
          ...lifecycleMetadata,
          result: {
            status: 'completed',
            timestamp: Date.now(),
            data: {
              outputMode: 'image',
              imageUrls: execution.imageDataUris,
              imageCount: execution.imageDataUris.length,
              workspaceImagePaths: execution.imagePaths,
              code: input.code,
              codeLanguage: 'python',
              usedAI: true,
              quality: 'medium',
              generationType: 'studio-plot'
            }
          }
        }
      },
      workMetadata: {
        ...lifecycleMetadata,
        currentResultId: workResult?.id,
        workspaceImagePaths: execution.imagePaths,
        scriptPath: execution.scriptPath
      }
    })

    if (workResult && completed.work && context.workStore) {
      const updatedWork = await context.workStore.update(completed.work.id, {
        currentResultId: workResult.id,
        metadata: {
          ...(completed.work.metadata ?? {}),
          currentResultId: workResult.id,
          workspaceImagePaths: execution.imagePaths,
          scriptPath: execution.scriptPath
        }
      })
      publishWorkUpdated(context, updatedWork ?? completed.work)
    }

    return {
      title,
      output: `plot_render_id: ${renderId}`,
      attachments: buildAttachments(execution.imageDataUris, execution.imagePaths),
      metadata: {
        renderId,
        taskId: completed.task?.id ?? task?.id,
        workId: completed.work?.id ?? work?.id,
        workResultId: workResult?.id,
        imageCount: execution.imageDataUris.length,
        scriptPath: execution.scriptPath,
        workspaceImagePaths: execution.imagePaths
      }
    }
  } catch (error) {
    if (studioRender && context.renderStore) {
      const failedRender = await context.renderStore.update(context.session.ownerId, studioRender.id, {
        status: isStudioRunCancelledError(error) ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      if (failedRender) {
        publishStudioRenderUpdated(context.eventBus, failedRender)
      }
      throw error
    }

    if (isStudioRunCancelledError(error)) {
      await updateTaskAndWork({
        context,
        task,
        work,
        taskPatch: {
          status: 'cancelled',
          metadata: {
            ...(task?.metadata ?? {}),
            ...lifecycleMetadata,
            cancelReason: error.reason,
          }
        },
        workMetadata: {
          ...lifecycleMetadata,
          cancelReason: error.reason,
        }
      })

      throw error
    }

    await persistFailureResult({
      context,
      workId: work?.id,
      taskId: task?.id,
      renderId,
      error: error instanceof Error ? error.message : String(error)
    })

    await updateTaskAndWork({
      context,
      task,
      work,
      taskPatch: {
        status: 'failed',
        metadata: {
          ...(task?.metadata ?? {}),
          ...lifecycleMetadata,
          error: error instanceof Error ? error.message : String(error)
        }
      },
      workMetadata: {
        ...lifecycleMetadata,
        error: error instanceof Error ? error.message : String(error)
      }
    })

    throw error
  }
}

async function persistWorkResult(input: {
  context: StudioRuntimeBackedToolContext
  workId?: string
  taskId?: string
  renderId: string
  code: string
  codeLanguage: 'python'
  execution: PlotRenderExecution
}): Promise<StudioWorkResult | null> {
  if (!input.workId || !input.context.workResultStore) {
    return null
  }

  const result = await input.context.workResultStore.create(createStudioWorkResult({
    workId: input.workId,
    kind: 'render-output',
    summary: `Plot render completed with ${input.execution.imageDataUris.length} image output(s)`,
    attachments: buildAttachments(input.execution.imageDataUris, input.execution.imagePaths),
    metadata: {
      taskId: input.taskId,
      renderId: input.renderId,
      studioKind: 'plot',
      code: input.code,
      codeLanguage: input.codeLanguage,
      imageCount: input.execution.imageDataUris.length,
      workspaceImagePaths: input.execution.imagePaths,
      scriptPath: input.execution.scriptPath,
      stdout: input.execution.stdout,
      stderr: input.execution.stderr
    }
  }))

  input.context.eventBus.publish({
    type: 'work_result_updated',
    sessionId: input.context.session.id,
    runId: input.context.run.id,
    result
  })

  return result
}

async function persistFailureResult(input: {
  context: StudioRuntimeBackedToolContext
  workId?: string
  taskId?: string
  renderId: string
  error: string
}): Promise<void> {
  if (!input.workId || !input.context.workResultStore) {
    return
  }

  const result = await input.context.workResultStore.create(createStudioWorkResult({
    workId: input.workId,
    kind: 'failure-report',
    summary: input.error,
    metadata: {
      taskId: input.taskId,
      renderId: input.renderId,
      studioKind: 'plot',
      error: input.error
    }
  }))

  input.context.eventBus.publish({
    type: 'work_result_updated',
    sessionId: input.context.session.id,
    runId: input.context.run.id,
    result
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

