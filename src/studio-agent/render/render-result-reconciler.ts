import type { StudioEventBus, StudioFileAttachment, StudioRender, StudioRenderStore } from '../domain/types'
import { publishStudioRenderUpdated } from './render-events'
import type { StudioRenderResultPort } from './render-result-port'
import {
  buildStudioRenderReconcileScopeKey,
  createStudioRenderReconcileCursor,
  readStudioRenderReconcileOrder,
  readStudioRenderReconcileWindow
} from './render-result-fairness'
import type { StudioRenderResult, StudioRenderResultMedia } from './render-result-types'
import {
  canTransitionStudioRenderStatus,
  isStudioRenderActiveStatus,
  isStudioRenderTerminalStatus
} from './render-status-transitions'

/**
 * Render result reconciliation (task 11C1M).
 *
 * A queued Studio render and the Manim job that backs it have independent lifecycles: the Agent Run
 * finishing says nothing about the render, and the render is only ever completed by the job store
 * saying so. This service is the one place that reads that outcome and writes it back, so a
 * completion push from the Worker later can call exactly the same code.
 *
 * Reconciliation is *read-triggered*: the Scene read model asks for the renders of one Scene, hands
 * them here, and gets the effective records back. There is no timer per render and no import of the
 * Worker or the queue in this module.
 *
 * The bound below keeps one read cheap, and the *rotation* keeps it fair: consecutive reads examine
 * consecutive slices of the candidate list, so a prefix of renders whose job result never resolves
 * cannot starve the renders behind it.
 */

/** Bound on the renders one snapshot read reconciles; the remainder is served by the next read. */
export const STUDIO_RENDER_RECONCILE_MAX_PER_READ = 8

/** Internal marker that a completed job produced no usable public media. Never a public field. */
export const STUDIO_RENDER_MEDIA_GAP_METADATA_KEY = 'mediaGap'
export const STUDIO_RENDER_MEDIA_GAP_METADATA_VALUE = 'missing_public_media'

export interface StudioRenderRecognition {
  ownerId: string
  sessionId: string
  sceneId: string
  renders: readonly StudioRender[]
}

export interface StudioRenderResultReconciler {
  /**
   * Reconciles the non-terminal Manim renders of exactly this owner/session/scene and answers the
   * effective records, so the caller's read model shows what was just persisted.
   */
  reconcileSceneRenders: (input: StudioRenderRecognition) => Promise<StudioRender[]>
}

export interface StudioRenderResultReconcilerDependencies {
  resultPort: StudioRenderResultPort
  renderStore: StudioRenderStore
  eventBus: StudioEventBus
}

export function createStudioRenderResultReconciler(
  dependencies: StudioRenderResultReconcilerDependencies
): StudioRenderResultReconciler {
  const { resultPort, renderStore, eventBus } = dependencies
  const cursors = createStudioRenderReconcileCursor()

  async function reconcileSceneRenders(input: StudioRenderRecognition): Promise<StudioRender[]> {
    const stored = [...input.renders]
    const scopeKey = buildStudioRenderReconcileScopeKey(input)
    const candidates = readStudioRenderReconcileOrder(
      stored.filter((render) => isReconcilableSceneRender(render, input))
    )

    if (!candidates.length) {
      // No backlog left for this Scene: drop its cursor instead of keeping an anchor for work that no
      // longer exists. The cursor is a hint, so losing it only costs one repeated sweep.
      cursors.clear(scopeKey)
      return stored
    }

    const { window, anchor } = readStudioRenderReconcileWindow(
      candidates,
      cursors.read(scopeKey),
      STUDIO_RENDER_RECONCILE_MAX_PER_READ
    )

    const effective = new Map(stored.map((render) => [render.id, render]))
    for (const render of window) {
      const jobId = render.jobId
      if (!jobId) {
        continue
      }

      let result: StudioRenderResult
      try {
        result = await resultPort.getRenderResult(jobId)
      } catch {
        // A port failure is the same answer as an unavailable store: no state may be invented.
        result = { status: 'unknown' }
      }

      const transition = readStudioRenderResultTransition(render, result)
      if (!transition) {
        continue
      }

      const outcome = await renderStore.transitionStatus({
        ownerId: input.ownerId,
        renderId: render.id,
        from: transition.from,
        expectedJobId: jobId,
        patch: transition.patch
      })

      // The stored record is the truth: a conditional write that lost the race answers the winner,
      // and the winner is what the read model shows and what (never) gets published.
      const winner = outcome.render ?? effective.get(render.id) ?? render
      effective.set(render.id, winner)

      if (outcome.applied) {
        publishStudioRenderUpdated(eventBus, winner)
      }
    }

    // Remember where this read stopped. The next read of this Scene continues after it, so the backlog
    // is swept round-robin instead of the same eight candidates being asked forever.
    if (anchor !== null) {
      cursors.write(scopeKey, anchor)
    }

    return stored.map((render) => effective.get(render.id) ?? render)
  }

  return { reconcileSceneRenders }
}

/**
 * True for a render this reconciliation may look at: a Manim render of exactly this owner, Session
 * and Scene, with a persisted job id, that has not already finished.
 */
export function isReconcilableSceneRender(
  render: StudioRender,
  scope: { ownerId: string; sessionId: string; sceneId: string }
): boolean {
  return (
    render.kind === 'manim' &&
    render.ownerId === scope.ownerId &&
    render.sessionId === scope.sessionId &&
    render.sceneId === scope.sceneId &&
    typeof render.jobId === 'string' &&
    render.jobId.length > 0 &&
    isStudioRenderActiveStatus(render.status)
  )
}

export interface StudioRenderResultTransition {
  /** Expected stored statuses of the conditional write. */
  from: readonly StudioRender['status'][]
  patch: Partial<StudioRender> & { status: StudioRender['status'] }
}

/**
 * Pure mapping from (stored render, observed job result) to a conditional write, or `null` when
 * nothing may be written:
 *
 * - a terminal render is never rewritten, so a late `running` observation cannot resurrect it;
 * - `unknown` never writes: the caller keeps the real status instead of inventing one;
 * - an observation that matches the stored status *and* attachments is not written or published
 *   again, so repeated reconciliation is idempotent;
 * - `completed` writes the public attachments the job really produced, or records the media
 *   capability gap when it produced none.
 */
export function readStudioRenderResultTransition(
  render: StudioRender,
  result: StudioRenderResult
): StudioRenderResultTransition | null {
  if (isStudioRenderTerminalStatus(render.status)) {
    return null
  }
  if (result.status === 'unknown') {
    return null
  }
  if (!isStudioRenderActiveStatus(render.status)) {
    return null
  }
  if (!canTransitionStudioRenderStatus([render.status], result.status)) {
    // The move itself is illegal: a retry observation must never demote `running` back to `queued`,
    // so the pure mapping refuses it before any write is attempted.
    return null
  }
  if (result.status === render.status) {
    return null
  }

  if (result.status !== 'completed') {
    return {
      from: [render.status],
      patch:
        result.status === 'failed' && result.error
          ? { status: 'failed', error: result.error }
          : { status: result.status }
    }
  }

  const attachments = readPublicRenderAttachments(result.media)

  return {
    from: [render.status],
    patch: attachments.length
      ? { status: 'completed', attachments }
      : {
          status: 'completed',
          metadata: {
            ...(render.metadata ?? {}),
            [STUDIO_RENDER_MEDIA_GAP_METADATA_KEY]: STUDIO_RENDER_MEDIA_GAP_METADATA_VALUE
          }
        }
  }
}

/** Public attachments of one result; every locator has already passed the media policy. */
export function readPublicRenderAttachments(
  media: readonly StudioRenderResultMedia[] | undefined
): StudioFileAttachment[] {
  if (!media?.length) {
    return []
  }

  return media.map((entry) => ({
    kind: 'file' as const,
    path: entry.locator,
    ...(entry.mimeType ? { mimeType: entry.mimeType } : {})
  }))
}
