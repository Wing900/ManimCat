/**
 * Job Cancel Route
 * POST /api/jobs/:jobId/cancel
 */

import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../http/middleware/async-route'
import { authMiddleware } from '../http/middleware/auth'
import { assertJobAccess } from '../rendering/job/job-access-store'
import { cancelJob } from '../rendering/job/job-cancel'
import { ValidationError } from '../shared/errors/errors'
import { getRequestClientId } from '../utils/request-client-id'

const router = express.Router()

router.post(
  '/jobs/:jobId/cancel',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params

    if (!jobId) {
      throw new ValidationError('Missing jobId')
    }

    await assertJobAccess({
      jobId,
      apiKey: res.locals.manimcatApiKey as string,
      clientId: getRequestClientId(req),
    })

    const result = await cancelJob(jobId)
    const status = result.jobState === 'completed'
      ? 'completed'
      : result.jobState === 'failed'
        ? 'failed'
        : 'cancelled'
    const message = status === 'completed'
      ? 'Job already completed'
      : status === 'failed'
        ? 'Job already failed'
        : 'Job cancelled'

    res.status(200).json({
      success: true,
      jobId,
      status,
      jobState: result.jobState,
      message
    })
  })
)

export default router
