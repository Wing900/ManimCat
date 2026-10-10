import express from 'express'
import {
  exportRenderFailureEvents,
  getRenderFailureAdminToken,
  isRenderFailureAdminEnabled
} from '../operations/render-failures'
import type { OutputMode } from '../types'

const router = express.Router()

function parseOutputMode(value: unknown): OutputMode | undefined {
  if (value === 'video' || value === 'image') {
    return value
  }
  return undefined
}

function parseLimit(value: unknown): number | undefined {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return parsed
}

router.get('/render-failures/export', async (req, res) => {
  if (!isRenderFailureAdminEnabled()) {
    return res.status(404).json({ error: 'Not found' })
  }

  const expectedToken = getRenderFailureAdminToken()
  const providedToken = String(req.headers['x-admin-token'] || '').trim()
  if (!providedToken || providedToken !== expectedToken) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  try {
    const rows = await exportRenderFailureEvents({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      errorType: typeof req.query.errorType === 'string' ? req.query.errorType : undefined,
      outputMode: parseOutputMode(req.query.outputMode),
      limit: parseLimit(req.query.limit)
    })

    return res.status(200).json(rows)
  } catch (error) {
    console.error('[RenderFailureRoute] Export failed:', error)
    return res.status(500).json({ error: 'Failed to export render failures' })
  }
})

export default router