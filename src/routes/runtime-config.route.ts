import express from 'express'
import { getStudioDataMode } from '../config/studio-data-mode'

const router = express.Router()

/**
 * GET /api/runtime-config
 *
 * The frontend is built once and must behave differently in the two deployment shapes, so it learns
 * which one it is running in from the server instead of from a build-time `import.meta.env` flag
 * (which would force one build per shape). Public on purpose: it carries no credential and no secret,
 * only which shape this deployment is.
 */
router.get('/runtime-config', (_req, res) => {
  res.json({ studioDataMode: getStudioDataMode() })
})

export default router
