/**
 * Express Application Entry Point
 * Express 应用主入口
 */

import 'dotenv/config'
import express, { type Request, Response, type NextFunction } from 'express'
import { appConfig, validateConfig, printConfig, isDevelopment } from './config/app'
import { redisClient } from './config/redis'
import { closeQueue } from './config/bull'
import { corsMiddleware } from './middlewares/cors'
import { errorHandler, notFoundHandler } from './middlewares/error-handler'
import { logger, createLogger } from './utils/logger'
import routes from './routes'
import type { Server } from 'http'
import path from 'path'

// 导入队列处理器以启动 worker
import './queues/processors/video.processor'

const app = express()
const appLogger = createLogger('Server')

let server: Server | null = null

/**
 * 请求日志中间件
 */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start
    // 只记录非查询状态的请求
    if (!req.path.includes('/jobs/')) {
      appLogger.info('Request completed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`
      })
    }
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
    app.use(express.json({ limit: '10mb' }))
    app.use(express.urlencoded({ extended: true, limit: '10mb' }))
    app.use(corsMiddleware)
    
    // JSON 解析错误处理
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err instanceof SyntaxError && 'body' in err) {
        appLogger.error('JSON 解析错误', {
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

    // 请求日志（开发环境）
    if (isDevelopment()) {
      app.use(requestLogger)
    }

    // 静态文件服务
    app.use(express.static('public'))

    // 挂载所有路由（包括健康检查和 API 路由）
    app.use(routes)

    // SPA fallback：任何非 API 请求都返回 React 的 index.html
    app.get('*', (req, res) => {
      // 跳过健康检查和 API 路由
      if (req.path.startsWith('/health') || req.path.startsWith('/api')) {
        return notFoundHandler(req, res, () => {})
      }
      // 返回 React 前端的 index.html
      const indexPath = path.join(__dirname, '..', 'public', 'index.html')
      res.sendFile(indexPath, (err) => {
        if (err) {
          return notFoundHandler(req, res, () => {})
        }
      })
    })

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
 * 尝试在指定端口启动服务器
 */
function tryListen(port: number, host: string, retries = 3): Promise<void> {
  return new Promise((resolve, reject) => {
    const attemptListen = (attemptNumber: number) => {
      server = app.listen(port, host)
        .on('listening', () => {
          appLogger.info(`🚀 Server listening on http://${host}:${port}`)
          appLogger.info(`📝 Environment: ${appConfig.nodeEnv}`)
          appLogger.info(`🔍 Health check: http://${host}:${port}/health`)
          resolve()
        })
        .on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            appLogger.warn(`Port ${port} is in use, attempt ${attemptNumber}/${retries}`)
            
            if (attemptNumber < retries) {
              // 等待一段时间后重试
              setTimeout(() => {
                attemptListen(attemptNumber + 1)
              }, 1000 * attemptNumber) // 递增等待时间
            } else {
              appLogger.error(`Failed to bind to port ${port} after ${retries} attempts`)
              reject(new Error(`Port ${port} is already in use. Please stop the existing process or use a different port.`))
            }
          } else {
            appLogger.error('Server error', { error })
            reject(error)
          }
        })
    }

    attemptListen(1)
  })
}

/**
 * 启动服务器
 */
async function startServer(): Promise<void> {
  await initializeApp()
  await tryListen(appConfig.port, appConfig.host)
  setupShutdownHandlers()
}

/**
 * 设置优雅关闭处理器
 */
function setupShutdownHandlers(): void {
  // 优雅关闭处理
  const shutdown = async (signal: string): Promise<void> => {
    appLogger.info(`Received ${signal}, starting graceful shutdown...`)

    if (!server) {
      appLogger.warn('Server instance not found, skipping server close')
      await cleanupResources()
      process.exit(0)
      return
    }

    // 停止接收新连接
    server.close(async (err) => {
      if (err) {
        appLogger.error('Error closing server', { error: err })
        process.exit(1)
      }

      await cleanupResources()
    })

    // 强制退出超时
    setTimeout(() => {
      appLogger.warn('Forced shutdown after timeout')
      process.exit(1)
    }, 10 * 60 * 1000) // 10 minutes timeout
  }

  // 清理资源
  const cleanupResources = async (): Promise<void> => {
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
  }

  // 监听退出信号
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



