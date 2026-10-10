import type { StudioToolDefinition, StudioToolResult } from '../../../domain/types'
import type { StudioRuntimeBackedToolContext } from '../../../runtime/tools/tool-runtime-context'
import type { OutputMode, VideoQuality } from '../../../../types'
import { createManimRenderJobId } from '../manim-render-port'
import type { StudioRenderDriver } from '../../../render/studio-render-driver'
import { manimRenderToolParameters } from '../../../tools/tool-parameters'
import { createStudioRender } from '../../../domain/factories'
import { publishStudioRenderUpdated } from '../../../render/render-events'
import {
  executeStudioRenderLifecycle,
  studioRenderFailureMessage,
  studioRenderFailureStatus
} from '../../../render/render-lifecycle'
import { STUDIO_RENDER_ACTIVE_STATUSES } from '../../../render/render-status-transitions'

interface ManimRenderToolInput {
  concept: string
  code: string
  outputMode?: OutputMode
  quality?: VideoQuality
}

export function createManimStudioRenderTool(
  driver: StudioRenderDriver
): StudioToolDefinition<ManimRenderToolInput> {
  return {
    name: 'render',
    parameters: manimRenderToolParameters,
    description: 'Render the Scene source and persist the video or images.',
    allowedAgents: ['builder'],
    allowedStudioKinds: ['manim'],
    execute: async (input, context) =>
      executeRenderTool(input, context as StudioRuntimeBackedToolContext, driver)
  }
}

async function executeRenderTool(
  input: ManimRenderToolInput,
  context: StudioRuntimeBackedToolContext,
  driver: StudioRenderDriver
): Promise<StudioToolResult> {
  if (!input.concept?.trim() || !input.code?.trim()) {
    throw new Error('Render tool requires non-empty "concept" and "code"')
  }

  const outputMode = input.outputMode ?? 'video'
  const quality = input.quality ?? 'medium'
  const jobId = createManimRenderJobId()

  return executeStudioRenderLifecycle({
    context,
    createRender: () =>
      createStudioRender({
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
      }),
    execute: async (render) => {
      await driver.execute({
        render,
        workspaceDirectory: context.session.directory,
        code: input.code,
        signal: context.abortSignal,
      })

      context.setToolMetadata?.({
        title: render.title,
        metadata: { renderId: render.id, jobId, outputMode, quality, phase: 'render' },
      })
      return {
        title: `Render queued ${jobId}`,
        output: `render_id: ${render.id}\nrender_job_id: ${jobId}`,
        metadata: { renderId: render.id, jobId, outputMode, quality, phase: 'render' },
      }
    },
    markFailed: async (render, renderStore, error) => {
      // The Manim job runs in the queue, so a completion may already have landed: only a render
      // still in an active status may be marked failed.
      const transition = await renderStore.transitionStatus({
        ownerId: context.session.ownerId,
        renderId: render.id,
        expectedJobId: jobId,
        from: STUDIO_RENDER_ACTIVE_STATUSES,
        patch: {
          status: studioRenderFailureStatus(error),
          error: studioRenderFailureMessage(error),
        }
      })
      if (transition.applied && transition.render) {
        publishStudioRenderUpdated(context.eventBus, transition.render)
      }
    }
  })
}
