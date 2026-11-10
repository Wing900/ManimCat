/**
 * Authenticated delivery of the server-prepared narration WAV for a browser job.
 *
 * The URL is derived from the job id and the immutable SHA-256 asset identity; it has
 * no filesystem path. Ownership is the same AccessContext + job-access record the
 * status/cancel routes already use. The route also requires that the requested asset
 * is exactly the one referenced by the stored completed result, so it cannot serve
 * arbitrary content from the job directory.
 */

import express, { type Request, type Response } from 'express'
import fs from 'node:fs'
import { asyncHandler } from '../http/middleware/async-route'
import { accessMiddleware } from '../http/middleware/access'
import { requireAccessContext } from '../http/access-context'
import { assertJobAccess } from '../rendering/job/job-access-store'
import {
  MAX_BROWSER_RENDER_AUDIO_BYTES,
  browserRenderNarrationAssetName,
  browserRenderNarrationUrl,
  isSafeBrowserRenderJobId,
  isSafeBrowserRenderNarrationAssetName,
  isSafeBrowserRenderNarrationSha256,
  resolveBrowserRenderNarrationPath,
} from '../rendering/browser/browser-render-assets'
import { getJobResult } from '../infrastructure/redis/job/redis-job-result-store'
import { getRequestClientId } from '../utils/request-client-id'
import { ValidationError } from '../shared/errors/errors'

const router = express.Router()

router.get(
  '/jobs/:jobId/browser-assets/:assetName',
  accessMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId, assetName } = req.params
    if (!jobId || !isSafeBrowserRenderJobId(jobId)) {
      throw new ValidationError('Invalid browser render job id')
    }
    if (!assetName || !isSafeBrowserRenderNarrationAssetName(assetName)) {
      throw new ValidationError('Invalid browser render asset name')
    }

    await assertJobAccess({
      jobId,
      ownerId: requireAccessContext(res).ownerId,
      clientId: getRequestClientId(req),
    })

    const result = await getJobResult(jobId)
    const completed = result?.status === 'completed' ? result.data : null
    const browserRender = completed?.browserRender
    const narration =
      completed?.renderTarget === 'browser' && browserRender && 'narration' in browserRender
        ? browserRender.narration
        : undefined
    if (
      !completed ||
      completed.renderTarget !== 'browser' ||
      !narration ||
      !isSafeBrowserRenderNarrationSha256(narration.sha256) ||
      narration.audioUrl !== browserRenderNarrationUrl(jobId, narration.sha256) ||
      assetName !== browserRenderNarrationAssetName(narration.sha256) ||
      !Number.isSafeInteger(narration.byteLength) ||
      narration.byteLength <= 0 ||
      narration.byteLength > MAX_BROWSER_RENDER_AUDIO_BYTES
    ) {
      res.status(404).json({ error: 'No browser narration asset exists for this job' })
      return
    }

    // The asset name is the SHA-256 of the exact bytes published for this result.
    // Publication is no-clobber, so a name can never point at different content.
    let filePath: string
    try {
      filePath = resolveBrowserRenderNarrationPath(jobId, narration.sha256)
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size !== narration.byteLength) {
        res.status(404).json({ error: 'Browser narration asset is unavailable' })
        return
      }
    } catch {
      res.status(404).json({ error: 'Browser narration asset is unavailable' })
      return
    }

    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Content-Disposition', 'inline; filename="narration.wav"')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ error: 'Browser narration asset is unavailable' })
      }
    })
  })
)

export default router
