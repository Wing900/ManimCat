import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import type { OutputMode, VideoQuality } from '../../types'
import {
  createManimRenderJobId,
  createUnconfiguredManimRenderPort,
  type ManimRenderPort
} from '../manim/manim-render-port'
import { manimRenderToolParameters } from './tool-parameters'
import { createStudioRender } from '../domain/factories'
import { publishStudioRenderUpdated } from '../render/render-events'
import { isStudioRunCancelledError, throwIfStudioRunCancelled } from '../runtime/execution/run-cancellation'
import { STUDIO_RENDER_ACTIVE_STATUSES } from '../render/render-status-transitions'

interface RenderToolInput {
  concept: string
  code: string
  outputMode?: OutputMode
  quality?: VideoQuality
}

export function createStudioRenderTool(
  renderPort: ManimRenderPort = createUnconfiguredManimRenderPort()
): StudioToolDefinition<RenderToolInput> {
  return {
    name: 'render',
    parameters: manimRenderToolParameters,
    description: 'Render the Scene source and persist the video or images.',
    allowedAgents: ['builder'],
    allowedStudioKinds: ['manim'],
    execute: async (input, context) =>
      executeRenderTool(input, context as StudioRuntimeBackedToolContext, renderPort)
  }
}

async function executeRenderTool(
  input: RenderToolInput,
  context: StudioRuntimeBackedToolContext,
  renderPort: ManimRenderPort
): Promise<StudioToolResult> {
  if (!input.concept?.trim() || !input.code?.trim()) {
    throw new Error('Render tool requires non-empty "concept" and "code"')
  }

  const outputMode = input.outputMode ?? 'video'
  const quality = input.quality ?? 'medium'

  const jobId = createManimRenderJobId()

  if (!context.renderStore) {
    throw new Error('Render store is unavailable')
  }

  const render = createStudioRender({
    ownerId: context.session.ownerId,
    sessionId: context.session.id,
    runId: context.run.id,
    // The Run is the authoritative scope source; a Legacy Run leaves the key absent.
    sceneId: context.run.sceneId,
    kind: 'manim',
    title: `Render: ${input.concept.slice(0, 80)}`,
    concept: input.concept,
    outputMode,
    quality,
    status: 'queued',
    jobId,
  })
  const createdRender = await context.renderStore.create(render)
  publishStudioRenderUpdated(context.eventBus, createdRender)

  try {
    // Persistence is asynchronous too: Stop may arrive while the record is being created.
    throwIfStudioRunCancelled(context.abortSignal)
    await renderPort.submit({
      jobId,
      concept: input.concept,
      code: input.code,
      outputMode,
      quality,
      workspaceDirectory: context.session.directory,
      signal: context.abortSignal
    })
  } catch (error) {
    const transition = await context.renderStore.transitionStatus({
      ownerId: context.session.ownerId,
      renderId: render.id,
      expectedJobId: jobId,
      from: STUDIO_RENDER_ACTIVE_STATUSES,
      patch: {
        status: isStudioRunCancelledError(error) ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    })
    if (transition.applied && transition.render) {
      publishStudioRenderUpdated(context.eventBus, transition.render)
    }
    throw error
  }

  context.setToolMetadata?.({
    title: render.title,
    metadata: { renderId: render.id, jobId, outputMode, quality, phase: 'render' },
  })
  return {
    title: `Render queued ${jobId}`,
    output: `render_id: ${render.id}\nrender_job_id: ${jobId}`,
    metadata: { renderId: render.id, jobId, outputMode, quality, phase: 'render' },
  }
}
