import express, { type NextFunction, type Request, type Response } from 'express'
import path from 'path'

interface RendererOriginConfig {
  host: string
  mainOrigin: string
  root: string
  csp: string
}

function normalizeHost(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (!value || value.includes('/') || value.includes(':') || value === '*') {
    throw new Error('BROWSER_RENDERER_HOST must be one concrete hostname without a port')
  }
  return value
}

function normalizeMainOrigin(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('BROWSER_RENDERER_MAIN_ORIGIN must be a valid HTTP(S) origin')
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('BROWSER_RENDERER_MAIN_ORIGIN must be one HTTP(S) origin')
  }
  return url.origin
}

function readConfig(): RendererOriginConfig | null {
  const hostRaw = process.env.BROWSER_RENDERER_HOST?.trim()
  if (!hostRaw) return null
  const mainRaw = process.env.BROWSER_RENDERER_MAIN_ORIGIN?.trim()
  if (!mainRaw) {
    throw new Error('BROWSER_RENDERER_MAIN_ORIGIN is required with BROWSER_RENDERER_HOST')
  }
  const host = normalizeHost(hostRaw)
  const mainOrigin = normalizeMainOrigin(mainRaw)
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    `frame-ancestors ${mainOrigin}`,
  ].join('; ')
  return { host, mainOrigin, root: path.join(process.cwd(), 'renderer'), csp }
}

function setRendererHeaders(res: Response, config: RendererOriginConfig): void {
  res.setHeader('Content-Security-Policy', config.csp)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  )
  res.setHeader('Cache-Control', 'no-store')
}

/**
 * Serve the isolated renderer artifact from a dedicated hostname on the same
 * container. DNS or the reverse proxy may point both hostnames at this service;
 * the Host boundary keeps APIs, media and the main application unavailable here.
 */
export function browserRendererOriginMiddleware() {
  const config = readConfig()
  const staticFiles = config
    ? express.static(config.root, { fallthrough: true, index: false })
    : null

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config || req.hostname.toLowerCase() !== config.host) {
      next()
      return
    }
    setRendererHeaders(res, config)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.sendStatus(405)
      return
    }
    if (
      req.path === '/' ||
      req.path === '/renderer' ||
      req.path === '/renderer/' ||
      req.path === '/browser-renderer.html'
    ) {
      res.sendFile(path.join(config.root, 'index.html'))
      return
    }
    if (!req.path.startsWith('/assets/') && !req.path.startsWith('/browser-rendering/')) {
      res.sendStatus(404)
      return
    }
    staticFiles!(req, res, () => res.sendStatus(404))
  }
}
