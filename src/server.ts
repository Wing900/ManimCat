/**
 * Express Application Entry Point
 * Express 应用主入口
 */

import 'dotenv/config'
import express from 'express'
import type { Server } from 'http'
import { redisClient } from './config/redis'
import { closeQueue } from './config/bull'
import { createLogger } from './utils/logger'
import { startMediaCleanupScheduler } from './services/media-cleanup'
import { appConfig, initializeExpressApp } from './server/bootstrap'
import { setupShutdownHandlers, tryListen } from './server/lifecycle'
import { studioEventRuntime } from './studio-agent/runtime/runtime-service'

// 导入队列处理器以启动 worker
import './queues/processors/video.processor'

const app = express()
const appLogger = createLogger('Server')

let server: Server | null = null
let stopMediaCleanupScheduler: (() => void) | null = null

async function cleanupResources(): Promise<void> {
  try {
    if (stopMediaCleanupScheduler) {
      stopMediaCleanupScheduler()
      stopMediaCleanupScheduler = null
    }

    // Close the Studio event subscriber before the shared Redis client, so shutdown does not
    // produce reconnect noise from a connection this process already owns. Idempotent.
    await studioEventRuntime.close()
    await closeQueue()
    await redisClient.quit()
    appLogger.info('Graceful shutdown completed')
  } catch (error) {
    appLogger.error('Error during shutdown', { error })
    throw error
  }
}

async function startServer(): Promise<void> {
  try {
    // Subscribe to the Studio event transport before HTTP/SSE traffic is accepted, so no
    // client attaches to a replica that is not yet receiving cross-instance events. A
    // configured Redis subscription failure rejects here and aborts startup.
    await studioEventRuntime.start()
    await initializeExpressApp(app, appLogger)

    if (!stopMediaCleanupScheduler) {
      stopMediaCleanupScheduler = startMediaCleanupScheduler()
    }

    server = await tryListen(app, appConfig.port, appConfig.host, appLogger)

    setupShutdownHandlers({
      getServer: () => server,
      onCleanup: cleanupResources,
      logger: appLogger
    })

    appLogger.info('Express application initialized successfully')
  } catch (error) {
    // Keep a raw stderr fallback to avoid silent startup failures
    // when production summary-only logging filters non-summary entries.
    console.error('[StartupFatal]', error)
    appLogger.error('Failed to start server', { error })
    // Release resources created before the failure (owned subscriber included) before exiting.
    try {
      await studioEventRuntime.close()
    } catch (closeError) {
      appLogger.warn('Failed to close the Studio event transport during startup failure', { error: closeError })
    }
    process.exit(1)
  }
}

void startServer()

// 导出 app 用于测试
export default app
