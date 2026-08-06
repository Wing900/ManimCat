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
    description: 'Create a Manim render task backed by the existing queue.',
    category: 'render',
    permission: 'render',
    allowedAgents: ['builder'],
    allowedStudioKinds: ['manim'],
    requiresTask: true,
    execute: async (input, context) => executeRenderTool(input, context as StudioRuntimeBackedToolContext, renderPort)
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

  const jobId = createManimRenderJobId()
  const outputMode = input.outputMode ?? 'video'
  const quality = input.quality ?? 'medium'

  if (!context.renderStore) {
    throw new Error('Render store is unavailable')
  }

  const render = createStudioRender({
    ownerId: context.session.ownerId,
    sessionId: context.session.id,
    runId: context.run.id,
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
    await renderPort.submit({
      jobId,
      concept: input.concept,
      code: input.code,
      outputMode,
      quality,
      workspaceDirectory: context.session.directory
    })
  } catch (error) {
    const failedRender = await context.renderStore.update(context.session.ownerId, render.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    if (failedRender) {
      publishStudioRenderUpdated(context.eventBus, failedRender)
    }
    throw error
  }

  context.setToolMetadata?.({
    title: render.title,
    metadata: { renderId: render.id, jobId, outputMode, quality },
  })
  return {
    title: `Render queued ${jobId}`,
    output: `render_id: ${render.id}\nrender_job_id: ${jobId}`,
    metadata: { renderId: render.id, jobId, outputMode, quality },
  }
}

