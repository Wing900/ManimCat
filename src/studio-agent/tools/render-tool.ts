import { v4 as uuidv4 } from 'uuid'
import type { StudioToolDefinition, StudioToolResult } from '../domain/types'
import type { StudioRuntimeBackedToolContext } from '../runtime/tools/tool-runtime-context'
import type { CustomApiConfig, OutputMode, VideoQuality } from '../../types'
import { videoQueue } from '../../config/bull'
import { storeJobStage } from '../../services/job-store'
import { createWorkAndTask } from '../works/work-lifecycle'
import { resolveJobTimeoutMs } from '../../utils/job-timeout'

interface RenderToolInput {
  concept: string
  code: string
  outputMode?: OutputMode
  quality?: VideoQuality
  customApiConfig?: CustomApiConfig
}

export function createStudioRenderTool(): StudioToolDefinition<RenderToolInput> {
  return {
    name: 'render',
    description: 'Create a Manim render task backed by the existing queue.',
    category: 'render',
    permission: 'render',
    allowedAgents: ['builder'],
    allowedStudioKinds: ['manim'],
    requiresTask: true,
    execute: async (input, context) => executeRenderTool(input, context as StudioRuntimeBackedToolContext)
  }
}

async function executeRenderTool(
  input: RenderToolInput,
  context: StudioRuntimeBackedToolContext
): Promise<StudioToolResult> {
  if (!input.concept?.trim() || !input.code?.trim()) {
    throw new Error('Render tool requires non-empty "concept" and "code"')
  }

  const jobId = uuidv4()
  const outputMode = input.outputMode ?? 'video'
  const quality = input.quality ?? 'medium'

  await storeJobStage(jobId, 'rendering')
  await videoQueue.add(
    {
      jobId,
      concept: input.concept,
      outputMode,
      quality,
      preGeneratedCode: input.code,
      customApiConfig: input.customApiConfig,
      timestamp: new Date().toISOString(),
      workspaceDirectory: context.session.directory
    },
    {
      jobId,
      timeout: resolveJobTimeoutMs()
    }
  )

  const lifecycleMetadata = {
    concept: input.concept,
    outputMode,
    quality,
    jobId
  }
  const title = `Render: ${input.concept.slice(0, 80)}`

  const { work, task } = await createWorkAndTask({
    context,
    work: {
      sessionId: context.session.id,
      runId: context.run.id,
      type: 'video',
      title,
      status: 'queued',
      metadata: lifecycleMetadata
    },
    task: {
      sessionId: context.session.id,
      runId: context.run.id,
      type: 'render',
      status: 'queued',
      title,
      detail: input.concept,
      metadata: {
        jobId,
        outputMode,
        quality
      }
    },
    workMetadata: lifecycleMetadata
  })

  return {
    title: `Render queued ${jobId}`,
    output: `render_job_id: ${jobId}`,
    metadata: {
      jobId,
      taskId: task?.id,
      workId: work?.id,
      outputMode,
      quality
    }
  }
}

