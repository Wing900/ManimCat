/**
 * Express Application Entry Point
 * Express 应用主入口
 */

import express, { type Request, Response, type NextFunction } from 'express'
import { appConfig, validateConfig, printConfig, isDevelopment } from './config/app'
import { redisClient } from './config/redis'
import { closeQueue } from './config/bull'
import { corsMiddleware } from './middlewares/cors'
import { errorHandler, notFoundHandler } from './middlewares/error-handler'
import { logger, createLogger } from './utils/logger'
import routes from './routes'

// 导入队列处理器以启动 worker
import './queues/processors/video.processor'

const app = express()
const appLogger = createLogger('Server')

/**
 * 请求日志中间件
 */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start
    appLogger.info('Request completed', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`
    })
  })

  next()
}

/**
 * 初始化应用
 */
async function initializeApp(): Promise<void> {
  try {
    // 验证配置
    validateConfig()

    // 基础中间件
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))
    app.use(corsMiddleware)

    // 请求日志（开发环境）
    if (isDevelopment()) {
      app.use(requestLogger)
    }

    // 静态文件服务
    app.use(express.static('public'))

    // 挂载所有路由（包括健康检查和 API 路由）
    app.use(routes)

    // 404 处理
    app.use(notFoundHandler)

    // 全局错误处理
    app.use(errorHandler)

    // 打印配置信息
    printConfig()

    appLogger.info('Express application initialized successfully')
  } catch (error) {
    appLogger.error('Failed to initialize application', { error })
    throw error
  }
}

/**
 * 启动服务器
 */
async function startServer(): Promise<void> {
  await initializeApp()

  const server = app.listen(appConfig.port, appConfig.host, () => {
    appLogger.info(`🚀 Server listening on http://${appConfig.host}:${appConfig.port}`)
    appLogger.info(`📝 Environment: ${appConfig.nodeEnv}`)
    appLogger.info(`🔍 Health check: http://${appConfig.host}:${appConfig.port}/health`)
  })

  // 优雅关闭处理
  const shutdown = async (signal: string): Promise<void> => {
    appLogger.info(`Received ${signal}, starting graceful shutdown...`)

    // 停止接收新连接
    server.close(async (err) => {
      if (err) {
        appLogger.error('Error closing server', { error: err })
        process.exit(1)
      }

      try {
        // 关闭队列
        await closeQueue()

        // 关闭 Redis 连接
        await redisClient.quit()

        appLogger.info('Graceful shutdown completed')
        process.exit(0)
      } catch (error) {
        appLogger.error('Error during shutdown', { error })
        process.exit(1)
      }
    })

    // 强制退出超时
    setTimeout(() => {
      appLogger.warn('Forced shutdown after timeout')
      process.exit(1)
    }, 30000) // 30 秒超时
  }

  // 监听退出退出信号
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // 未捕获异常处理
  process.on('uncaughtException', (error) => {
    appLogger.error('Uncaught exception', { error })
    shutdown('UNCAUGHT_EXCEPTION')
  })

  process.on('unhandledRejection', (reason, promise) => {
    appLogger.error('Unhandled rejection', { reason, promise })
    shutdown('UNHANDLED_REJECTION')
  })
}

// 启动应用
startServer().catch((error) => {
  appLogger.error('Failed to start server', { error })
  process.exit(1)
})

// 导出 app 用于测试
export default app
