import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Response } from 'express'
import type { StudioRender } from '../../studio-agent/domain/types'
import { createLogger } from '../../utils/logger'
import { sendStudioError } from './studio-agent-responses'

const logger = createLogger('StudioRenderMedia')

/** Directory of rendered media under `public/`, mirrored by the queue that writes the files. */
export const STUDIO_RENDER_MEDIA_DIRECTORY = 'videos'

/** A stored record id: no separators, no dot-leading names, bounded. */
const STUDIO_RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** A media filename stem, which is what a job id becomes on disk. */
const STUDIO_MEDIA_STEM_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

/**
 * Delivers one Render's video to its owner, then deletes it.
 *
 * The browser is the durable store, so this is a hand-off rather than a download: the file exists on
 * the server only between the render finishing and this response completing. Two consequences are
 * deliberate:
 *
 * - The delete happens only after the stream completes. A connection that drops mid-transfer leaves
 *   the file in place, because a partial video is not a copy the browser can keep.
 * - A missing file is a 404 rather than a re-render. The client is expected to render again, which is
 *   cheap, instead of this endpoint inventing a recovery.
 *
 * Every failure answers with the same non-enumerating 404 shape, so a caller cannot learn whether an
 * id exists, belongs to someone else, or belongs to another Scene.
 */
export async function handleStudioRenderMediaRequest(input: {
  res: Response
  ownerId: string
  sessionId: string
  sceneId: string
  renderId: string
  getRender: (ownerId: string, renderId: string) => Promise<StudioRender | null>
  /**
   * Experimental destructive mode, disabled by default. A completed HTTP stream does not prove
   * that browser storage committed; production must keep this off until delivery acknowledgement.
   */
  removeAfterDelivery?: boolean
  /** Overridable so a spec can point at its own directory. */
  publicDirectory?: string
}): Promise<void> {
  const notFound = () => sendStudioError(input.res, 404, 'NOT_FOUND', 'Render media is not available')

  if (!STUDIO_RECORD_ID_PATTERN.test(input.renderId)) {
    return notFound()
  }

  const render = await input.getRender(input.ownerId, input.renderId)
  if (!render || render.sessionId !== input.sessionId || render.sceneId !== input.sceneId) {
    return notFound()
  }

  const stem = render.jobId
  if (!stem || !STUDIO_MEDIA_STEM_PATTERN.test(stem)) {
    return notFound()
  }

  const directory = path.join(input.publicDirectory ?? path.join(process.cwd(), 'public'), STUDIO_RENDER_MEDIA_DIRECTORY)
  // Resolve both sides and require the file to sit directly in the media directory: an id that is
  // shaped like a filename still cannot be used to reach a symlink's target elsewhere.
  const realDirectory = await fsp.realpath(directory).catch(() => null)
  const realFile = await fsp.realpath(path.join(directory, `${stem}.mp4`)).catch(() => null)
  if (!realDirectory || !realFile || path.dirname(realFile) !== realDirectory) {
    return notFound()
  }

  input.res.setHeader('Content-Type', 'video/mp4')
  input.res.setHeader('Cache-Control', 'no-store')

  try {
    await pipeline(createReadStream(realFile), input.res)
  } catch (error) {
    // A failed transfer must not delete the file: the client did not receive a usable copy.
    logger.warn('Studio render media delivery failed', {
      renderId: input.renderId,
      reason: error instanceof Error ? error.name : 'unknown'
    })
    return
  }

  if (input.removeAfterDelivery === true) {
    try {
      await fsp.unlink(realFile)
    } catch (error) {
      // A file that could not be removed is retried by the media retention sweep.
      logger.warn('Studio render media removal failed', {
        renderId: input.renderId,
        reason: error instanceof Error ? error.name : 'unknown'
      })
    }
  }
}
