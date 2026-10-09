import type { StudioEventBus, StudioRenderStore, StudioRun } from '../domain/types'
import type { ManimRenderPort } from '../manim/manim-render-port'
import { publishStudioRenderUpdated } from './render-events'
import { STUDIO_RENDER_ACTIVE_STATUSES, isStudioRenderActiveStatus } from './render-status-transitions'

/** Cancel only persisted queue jobs belonging to this exact owner, Session and Run. */
export async function cancelStudioRunRenders(input: {
  run: StudioRun
  renderStore: StudioRenderStore
  eventBus: StudioEventBus
  manimRenderPort?: ManimRenderPort
}): Promise<void> {
  const renders = await input.renderStore.listBySessionId(input.run.ownerId, input.run.sessionId)
  for (const render of renders) {
    if (render.ownerId !== input.run.ownerId || render.sessionId !== input.run.sessionId ||
        render.runId !== input.run.id || render.sceneId !== input.run.sceneId ||
        render.kind !== 'manim' || !render.jobId || !isStudioRenderActiveStatus(render.status)) {
      continue
    }
    if (!input.manimRenderPort?.cancel) {
      throw new Error('Render cancellation is not configured')
    }
    const outcome = await input.manimRenderPort.cancel(render.jobId)
    // Completion may have won; the result reconciler owns completed/failed media and errors.
    if (outcome !== 'cancelled') continue
    const transition = await input.renderStore.transitionStatus({
      ownerId: input.run.ownerId,
      renderId: render.id,
      expectedJobId: render.jobId,
      from: STUDIO_RENDER_ACTIVE_STATUSES,
      patch: { status: 'cancelled' }
    })
    if (!transition.render) throw new Error('Render cancellation could not be persisted')
    if (transition.applied) publishStudioRenderUpdated(input.eventBus, transition.render)
  }
}
