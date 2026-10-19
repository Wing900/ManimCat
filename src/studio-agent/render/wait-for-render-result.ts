import { setTimeout as delay } from 'node:timers/promises'
import type { StudioEventBus, StudioRender, StudioRenderStore } from '../domain/types'
import type { StudioRenderDriver } from './studio-render-driver'
import { readStudioRenderResultTransition } from './render-result-reconciler'
import { publishStudioRenderUpdated } from './render-events'
import { isStudioRenderTerminalStatus } from './render-status-transitions'
import { throwIfStudioRunCancelled } from '../runtime/execution/run-cancellation'

/** Keep a queued render inside its tool call, so the model receives the real outcome. */
export async function waitForStudioRenderResult(input: {
  render: StudioRender
  driver: StudioRenderDriver
  renderStore: StudioRenderStore
  eventBus: StudioEventBus
  signal?: AbortSignal
  timeoutMs: number
}): Promise<{ render: StudioRender; error?: string }> {
  const { driver, renderStore, signal } = input
  const jobId = input.render.jobId
  if (!jobId || !driver.reconcile) {
    throw new Error('Queued renderer must expose a job result reader')
  }
  let current = input.render
  const deadline = performance.now() + input.timeoutMs
  try {
    while (true) {
      throwIfStudioRunCancelled(signal)
      // A transient read failure keeps the render pending; it is never fabricated as failed.
      const result = await driver.reconcile(jobId).catch(() => ({ status: 'unknown' as const }))
      throwIfStudioRunCancelled(signal)
      const transition = readStudioRenderResultTransition(current, result)
      if (transition) {
        const outcome = await renderStore.transitionStatus({
          ownerId: current.ownerId,
          renderId: current.id,
          expectedJobId: jobId,
          from: transition.from,
          patch: transition.patch,
        })
        current = outcome.render ?? current
        if (outcome.applied) publishStudioRenderUpdated(input.eventBus, current)
      }
      if (isStudioRenderTerminalStatus(current.status)) {
        return { render: current, error: result.status === 'failed' ? result.error ?? current.error : current.error }
      }
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        await driver.cancel?.(jobId)
        throw new Error('Render did not finish before its deadline; the queued job was stopped')
      }
      await delay(Math.min(1000, remaining), undefined, { signal })
    }
  } catch (error) {
    if (signal?.aborted) {
      await driver.cancel?.(jobId).catch(() => undefined)
      throwIfStudioRunCancelled(signal)
    }
    throw error
  }
}
