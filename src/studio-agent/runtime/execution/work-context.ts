import type { StudioFileAttachment, StudioRenderContext, StudioRenderStore } from '../../domain/types'

interface BuildStudioRenderContextInput {
  ownerId: string
  sessionId: string
  agent: string
  renderStore?: StudioRenderStore
}

export async function buildStudioRenderContext(input: BuildStudioRenderContextInput): Promise<StudioRenderContext> {
  const context: StudioRenderContext = {
    sessionId: input.sessionId,
    agent: input.agent
  }

  if (input.renderStore) {
    const renders = await input.renderStore.listBySessionId(input.ownerId, input.sessionId)
    const latestRender = [...renders].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
    if (latestRender) {
      context.latestRender = {
        id: latestRender.id,
        status: mapRenderStatus(latestRender.status),
        timestamp: Date.parse(latestRender.updatedAt),
        output: {
          videoPath: findAttachment(latestRender.attachments, 'video/'),
          imagePaths: listAttachments(latestRender.attachments, 'image/')
        },
        error: latestRender.error
      }
    }
  }

  return context
}

function mapRenderStatus(status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'): 'pending' | 'running' | 'completed' | 'failed' {
  if (status === 'queued') {
    return 'pending'
  }
  if (status === 'cancelled') {
    return 'failed'
  }
  return status
}

function findAttachment(attachments: StudioFileAttachment[] | undefined, prefix: string): string | undefined {
  return attachments?.find((attachment) => attachment.mimeType?.startsWith(prefix))?.path
}

function listAttachments(attachments: StudioFileAttachment[] | undefined, prefix: string): string[] | undefined {
  const paths = attachments?.filter((attachment) => attachment.mimeType?.startsWith(prefix)).map((attachment) => attachment.path) ?? []
  return paths.length ? paths : undefined
}

