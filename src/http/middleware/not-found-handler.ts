/**
 * 404 Not Found boundary.
 */

import type { Request, Response, NextFunction } from 'express'

export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method,
  })
}
