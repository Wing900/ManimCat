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
    appLogger.error('Failed to start server', { error })
    process.exit(1)
  }
}

void startServer()

// 导出 app 用于测试
export default app
