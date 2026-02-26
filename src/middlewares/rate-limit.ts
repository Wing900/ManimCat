import type { NextFunction, Request, Response } from 'express'

interface RateLimitOptions {
  windowMs: number
  maxRequests: number
  message?: string
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

function parseClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) {
      return firstIp
    }
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    const firstIp = forwardedFor[0]?.trim()
    if (firstIp) {
      return firstIp
    }
  }

  return req.ip || req.socket.remoteAddress || 'unknown'
}

export function createIpRateLimiter(options: RateLimitOptions) {
  const { windowMs, maxRequests, message = 'Too many requests, please try again later.' } = options
  const counters = new Map<string, RateLimitEntry>()
  const cleanupIntervalMs = Math.max(1000, Math.min(windowMs, 60_000))
  let lastCleanupAt = 0

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now()

    if (now - lastCleanupAt >= cleanupIntervalMs) {
      for (const [key, entry] of counters.entries()) {
        if (entry.resetAt <= now) {
          counters.delete(key)
        }
      }
      lastCleanupAt = now
    }

    const clientIp = parseClientIp(req)
    const current = counters.get(clientIp)

    if (!current || current.resetAt <= now) {
      counters.set(clientIp, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    if (current.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSeconds))
      res.status(429).json({
        error: 'Rate limit exceeded',
        message,
        retryAfterSeconds
      })
      return
    }

    current.count += 1
    counters.set(clientIp, current)
    next()
  }
}
