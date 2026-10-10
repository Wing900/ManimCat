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
import {
  getStudioWorkspaceRootDirectory,
  startStudioWorkspaceCleanupScheduler
} from './studio-agent/infrastructure/workspace/studio-workspace-cleanup'
import { appConfig, initializeExpressApp } from './server/bootstrap'
import { setupShutdownHandlers, tryListen } from './server/lifecycle'
import { getApiRagService } from './services/api-rag'
import { setStudioTelemetry } from './studio-agent/infrastructure/telemetry/studio-telemetry'
import { createPlotStudioTelemetryAdapter } from './studio-agent/infrastructure/telemetry/plot-studio-timing'
import { studioInfrastructureRuntime } from './studio-agent/runtime/runtime-service'

// 导入队列处理器以启动 worker
import './queues/processors/video.processor'

const app = express()
const appLogger = createLogger('Server')

let server: Server | null = null
let stopMediaCleanupScheduler: (() => void) | null = null
let stopStudioWorkspaceCleanup: (() => void) | null = null

async function cleanupResources(): Promise<void> {
  try {
    if (stopStudioWorkspaceCleanup) {
      stopStudioWorkspaceCleanup()
      stopStudioWorkspaceCleanup = null
    }

    if (stopMediaCleanupScheduler) {
      stopMediaCleanupScheduler()
      stopMediaCleanupScheduler = null
    }

    // Close the Studio infrastructure before the shared Redis client, so shutdown does not
    // produce reconnect noise from connections this process already owns. Run coordination
    // stops owning Runs before the event subscriber goes away. Idempotent.
    await studioInfrastructureRuntime.close()
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
    // Subscribe to the Studio infrastructure before HTTP/SSE traffic is accepted, so no
    // client attaches to a replica that is not yet receiving cross-instance events and no Run
    // is admitted on a replica that cannot take a session lease. A configured Redis failure
    // rejects here and aborts startup; a partial startup is rolled back before rejecting.
    await studioInfrastructureRuntime.start()
    await initializeExpressApp(app, appLogger)

    // The API RAG service is the only API source for the Builder and for Workflow Code
    // Repair. Its Baseline, Search Catalog and MiniLM session load here, before the
    // listener opens: a missing or malformed catalog must abort startup instead of
    // leaving the product able to answer with invented APIs.
    await getApiRagService().ready()

    // The shared Runtime emits neutral telemetry events; the Matplotlib adapter wires them
    // to the existing Chinese-label logger and console timeline.
    setStudioTelemetry(createPlotStudioTelemetryAdapter())

    if (!stopMediaCleanupScheduler) {
      stopMediaCleanupScheduler = startMediaCleanupScheduler()
    }

    // Session workspaces are scratch space (STUDIO_WORKSPACE_TTL_HOURS, 5 by default). The browser
    // holds the durable copy, so an expired workspace is thrown away rather than archived.
    if (!stopStudioWorkspaceCleanup) {
      stopStudioWorkspaceCleanup = startStudioWorkspaceCleanupScheduler(getStudioWorkspaceRootDirectory())
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
    // Release resources created before the failure (coordination and the owned subscriber
    // included) before exiting.
    try {
      await studioInfrastructureRuntime.close()
    } catch (closeError) {
      appLogger.warn('Failed to close the Studio infrastructure during startup failure', { error: closeError })
    }
    process.exit(1)
  }
}

void startServer()

// 导出 app 用于测试
export default app
