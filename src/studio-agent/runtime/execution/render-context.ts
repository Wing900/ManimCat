import type { StudioRenderContext, StudioRenderStore } from '../../domain/types'

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
