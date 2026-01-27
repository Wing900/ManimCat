/**
 * Job Cancel Route
 * POST /api/jobs/:jobId/cancel
 */

import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../middlewares/error-handler'
import { cancelJob } from '../services/job-cancel'
import { ValidationError } from '../utils/errors'

const router = express.Router()

router.post(
  '/jobs/:jobId/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params

    if (!jobId) {
      throw new ValidationError('Missing jobId')
    }

    const result = await cancelJob(jobId)
    const status = result.jobState == 'completed' ? 'completed' : 'cancelled'
    const message = status == 'completed' ? 'Job already completed' : 'Job cancelled'

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
