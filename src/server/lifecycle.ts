import type express from 'express'
import type { Server } from 'http'

interface LoggerLike {
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}

export function tryListen(
  app: express.Express,
  port: number,
  host: string,
  logger: LoggerLike,
  retries = 3
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const attemptListen = (attemptNumber: number) => {
      const server = app
        .listen(port, host)
        .on('listening', () => {
          logger.info(`🚀 Server listening on http://${host}:${port}`)
          logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`)
          logger.info(`🔍 Health check: http://${host}:${port}/health`)
          resolve(server)
        })
        .on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            logger.warn(`Port ${port} is in use, attempt ${attemptNumber}/${retries}`)
            if (attemptNumber < retries) {
              setTimeout(() => {
                attemptListen(attemptNumber + 1)
              }, 1000 * attemptNumber)
            } else {
              logger.error(`Failed to bind to port ${port} after ${retries} attempts`)
              reject(
                new Error(
                  `Port ${port} is already in use. Please stop the existing process or use a different port.`
                )
              )
            }
          } else {
            logger.error('Server error', { error })
            reject(error)
          }
        })
    }

    attemptListen(1)
  })
}

interface ShutdownOptions {
  getServer: () => Server | null
  onCleanup: () => Promise<void>
  logger: LoggerLike
}

export function setupShutdownHandlers(options: ShutdownOptions): void {
  const { getServer, onCleanup, logger } = options

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, starting graceful shutdown...`)

    const server = getServer()
    if (!server) {
      logger.warn('Server instance not found, skipping server close')
      await onCleanup()
      process.exit(0)
      return
    }

    server.close(async (err) => {
      if (err) {
        logger.error('Error closing server', { error: err })
        process.exit(1)
      }
      await onCleanup()
      process.exit(0)
    })

    setTimeout(() => {
      logger.warn('Forced shutdown after timeout')
      process.exit(1)
    }, 10 * 60 * 1000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error })
    shutdown('UNCAUGHT_EXCEPTION')
  })

  process.on('unhandledRejection', (reason) => {
    // `{ reason }` logs as `{}`: an Error's properties are not enumerable, so the message and the
    // stack — the only two things that identify the failure — were being dropped.
    logger.error('Unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined
    })
    shutdown('UNHANDLED_REJECTION')
  })
}
