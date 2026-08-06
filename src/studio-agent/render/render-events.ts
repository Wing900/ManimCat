import type { StudioEventBus, StudioRender } from '../domain/types'

export function publishStudioRenderUpdated(eventBus: StudioEventBus, render: StudioRender): void {
  eventBus.publish({
    type: 'render_updated',
    sessionId: render.sessionId,
    runId: render.runId,
    render,
  })
}
