import express, { type Request, type Response, type NextFunction } from 'express'
import path from 'path'
import { appConfig, isDevelopment, printConfig, validateConfig } from '../config/app'
import { corsMiddleware } from '../middlewares/cors'
import { errorHandler, notFoundHandler } from '../middlewares/error-handler'
import routes from '../routes'

interface LoggerLike {
  info(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

function requestLoggerFactory(logger: LoggerLike) {
  return function requestLogger(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      if (!req.path.includes('/jobs/')) {
        logger.info('Request completed', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration: `${duration}ms`
        })
      }
    })

    next()
  }
}

export async function initializeExpressApp(app: express.Express, logger: LoggerLike): Promise<void> {
  validateConfig()

  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true, limit: '10mb' }))
  app.use(corsMiddleware)

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      logger.error('JSON 解析错误', {
        method: req.method,
        path: req.path,
        error: err.message,
        body: req.body
      })
      return res.status(400).json({
        error: 'Invalid JSON',
        message: err.message
      })
    }
    next(err)
  })

  if (isDevelopment()) {
    app.use(requestLoggerFactory(logger))
  }

  app.use('/images', express.static(path.join(process.cwd(), 'public', 'images'), { fallthrough: false }))
  app.use('/videos', express.static(path.join(process.cwd(), 'public', 'videos'), { fallthrough: false }))
  app.use(express.static('public'))
  app.use(routes)

  app.get('*', (req, res) => {
    if (req.path.startsWith('/health') || req.path.startsWith('/api')) {
      return notFoundHandler(req, res, () => {})
    }
    if (path.extname(req.path)) {
      return notFoundHandler(req, res, () => {})
    }
    const indexPath = path.join(__dirname, '..', '..', 'public', 'index.html')
    res.sendFile(indexPath, (err) => {
      if (err) {
        return notFoundHandler(req, res, () => {})
      }
    })
  })

  app.use(errorHandler)
  printConfig()
}

export { appConfig }
