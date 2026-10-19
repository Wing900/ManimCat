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
import { waitForStudioRenderResult } from '../../../render/wait-for-render-result'
import { resolveJobTimeoutMs } from '../../../../utils/job-timeout'
import { StudioRunCancelledError } from '../../../runtime/execution/run-cancellation'

interface ManimRenderToolInput {
  concept: string
  code: string
  sceneName?: string
  outputMode?: OutputMode
  quality?: VideoQuality
}

export function createManimStudioRenderTool(
  driver: StudioRenderDriver
): StudioToolDefinition<ManimRenderToolInput> {
  return {
    name: 'render',
    parameters: manimRenderToolParameters,
    description: 'Render the Scene source and wait for the actual video or images. A render failure returns its error so you can fix the source and render again.',
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
  const sceneName = input.sceneName?.trim() || undefined
  if (sceneName && outputMode !== 'video') {
    throw new Error('sceneName selects a video scene; each image block selects its own scene automatically')
  }
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
        metadata: sceneName ? { sceneName } : undefined,
      }),
    execute: async (render, renderStore) => {
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
      const outcome = await waitForStudioRenderResult({
        render, driver, renderStore, eventBus: context.eventBus,
        signal: context.abortSignal,
        timeoutMs: resolveJobTimeoutMs() + 60_000,
      })
      if (outcome.render.status === 'cancelled') {
        throw new StudioRunCancelledError('Render cancelled')
      }
      if (outcome.render.status === 'failed') {
        throw new Error(`Render failed. Fix the source using this error, then call render again:\n${outcome.error || 'No renderer error was recorded'}`)
      }
      return {
        title: `Render ${render.metadata?.label ?? ''} completed`,
        output: `status: completed\nversion: ${render.metadata?.label}\noutput_directory: ${render.metadata?.workspaceOutputDirectory}\nrender_id: ${render.id}\nrender_job_id: ${jobId}`,
        attachments: outcome.render.attachments,
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
