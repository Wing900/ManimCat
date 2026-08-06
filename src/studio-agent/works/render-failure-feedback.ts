import { createStudioAssistantMessage, createStudioTextPart } from '../domain/factories'
import type {
  StudioMessageStore,
  StudioPartStore,
  StudioSessionStore,
  StudioTask
} from '../domain/types'
import type { JobResult } from '../../types'

interface PublishRenderFailureFeedbackInput {
  ownerId: string
  task: StudioTask
  sessionStore: StudioSessionStore
  messageStore: StudioMessageStore
  partStore: StudioPartStore
}

export async function publishRenderFailureFeedback(
  input: PublishRenderFailureFeedbackInput
): Promise<void> {
  const jobId = typeof input.task.metadata?.jobId === 'string' ? input.task.metadata.jobId : undefined
  if (!jobId) {
    return
  }

  const result = getFailedResult(input.task)
  if (!result) {
    return
  }

  const session = await input.sessionStore.getById(input.ownerId, input.task.sessionId)
  if (!session) {
    return
  }

  const assistantMessage = await input.messageStore.createAssistantMessage(
    createStudioAssistantMessage({
      sessionId: session.id,
      agent: session.agentType
    })
  )
  const text = createStudioTextPart({
    messageId: assistantMessage.id,
    sessionId: session.id,
    text: [
      `Render task failed: ${input.task.title}`,
      `render_job_id: ${jobId}`,
      `error: ${result.data.error}`,
      result.data.details ? `details: ${result.data.details}` : ''
    ].filter(Boolean).join('\n')
  })

  await input.partStore.create(text)
  await input.messageStore.updateAssistantMessage(assistantMessage.id, {
    parts: [text]
  })
}

function getFailedResult(task: StudioTask): Extract<JobResult, { status: 'failed' }> | null {
  const candidate = task.metadata?.result
  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  if ((candidate as { status?: unknown }).status !== 'failed') {
    return null
  }

  return candidate as Extract<JobResult, { status: 'failed' }>
}
