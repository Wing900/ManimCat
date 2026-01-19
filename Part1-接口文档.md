# Part 1 接口文档 - 基础设施层

**工兵 A 交付物** | 版本 1.0 | 2026-01-19

---

## 📦 已完成交付物清单

✅ **依赖管理**
- 安装：bull, ioredis, cors, dotenv
- 移除：motia, redis-server
- package.json 脚本更新完成

✅ **配置文件**（3个）
- [`src/config/redis.ts`](src/config/redis.ts:1) - Redis 连接配置
- [`src/config/bull.ts`](src/config/bull.ts:1) - Bull 队列配置
- [`src/config/app.ts`](src/config/app.ts:1) - 应用全局配置

✅ **类型定义**（1个）
- [`src/types/index.ts`](src/types/index.ts:1) - 全局类型定义

✅ **工具函数**（2个）
- [`src/utils/logger.ts`](src/utils/logger.ts:1) - 统一日志工具
- [`src/utils/errors.ts`](src/utils/errors.ts:1) - 错误处理工具

✅ **中间件**（2个）
- [`src/middlewares/error-handler.ts`](src/middlewares/error-handler.ts:1) - 错误处理中间件
- [`src/middlewares/cors.ts`](src/middlewares/cors.ts:1) - CORS 中间件

---

## 🔧 核心 API 使用指南

### 1. Redis 配置（`src/config/redis.ts`）

#### 导出内容

```typescript
// Redis 客户端实例（单例）
export const redisClient: Redis

// 创建新的 Redis 客户端
export function createRedisClient(): Redis

// Redis 键名前缀常量
export const REDIS_KEYS: {
  JOB_RESULT: 'job:result:',
  CONCEPT_CACHE: 'concept:cache:',
  QUEUE_PREFIX: 'bull:'
}

// 生成 Redis 键名
export function generateRedisKey(prefix: string, id: string): string

// 检查 Redis 连接
export function checkRedisConnection(client: Redis): Promise<boolean>
```

#### 使用示例

```typescript
import { redisClient, REDIS_KEYS, generateRedisKey } from '../config/redis'

// 存储任务结果
const key = generateRedisKey(REDIS_KEYS.JOB_RESULT, jobId)
await redisClient.set(key, JSON.stringify(result), 'EX', 86400)

// 读取任务结果
const data = await redisClient.get(key)
const result = data ? JSON.parse(data) : null
```

---

### 2. Bull 队列配置（`src/config/bull.ts`）

#### 导出内容

```typescript
// 视频生成队列实例（单例）
export const videoQueue: Queue

// 清理队列（开发调试用）
export async function cleanQueue(): Promise<void>

// 获取队列统计信息
export async function getQueueStats(): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  total: number
}>

// 优雅关闭队列
export async function closeQueue(): Promise<void>

// 检查队列健康状态
export async function checkQueueHealth(): Promise<boolean>
```

#### 使用示例

```typescript
import { videoQueue, getQueueStats } from '../config/bull'

// 添加任务到队列
const job = await videoQueue.add({
  jobId: 'uuid-here',
  concept: 'pythagorean theorem',
  quality: 'low',
  timestamp: new Date().toISOString()
})

// 获取队列统计
const stats = await getQueueStats()
console.log(`等待中: ${stats.waiting}, 进行中: ${stats.active}`)
```

---

### 3. 应用配置（`src/config/app.ts`）

#### 导出内容

```typescript
// 应用配置对象
export const appConfig: {
  port: number
  host: string
  nodeEnv: string
  cors: { origin: string, credentials: boolean }
  timeout: { request: number, job: number }
  logging: { level: string, pretty: boolean }
  openai: { apiKey: string, model: string, temperature: number, maxTokens: number }
  cache: { enabled: boolean, ttl: number }
  manim: { quality: Record<string, string>, timeout: number }
  paths: { videos: string, temp: string }
}

// 验证必需的环境变量
export function validateConfig(): void

// 环境检查
export function isDevelopment(): boolean
export function isProduction(): boolean

// 打印配置信息
export function printConfig(): void
```

#### 使用示例

```typescript
import { appConfig, validateConfig, printConfig } from '../config/app'

// 验证配置
validateConfig()

// 使用配置
const port = appConfig.port
const apiKey = appConfig.openai.apiKey

// 打印配置（启动时）
printConfig()
```

---

### 4. 类型定义（`src/types/index.ts`）

#### 核心类型

```typescript
// 视频质量
type VideoQuality = 'low' | 'medium' | 'high'

// 任务状态
type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

// 生成类型
type GenerationType = 'template' | 'ai' | 'cached'

// 任务数据
interface VideoJobData {
  jobId: string
  concept: string
  quality: VideoQuality
  forceRefresh?: boolean
  timestamp: string
}

// 任务结果
type JobResult = CompletedJobResult | FailedJobResult

// API 请求/响应
interface GenerateRequest { ... }
interface GenerateResponse { ... }
type JobStatusResponse = JobStatusProcessingResponse | JobStatusCompletedResponse | JobStatusFailedResponse
interface HealthCheckResponse { ... }
interface ErrorResponse { ... }
```

#### 使用示例

```typescript
import type { 
  VideoJobData, 
  JobResult, 
  GenerateRequest,
  HealthCheckResponse 
} from '../types'

// 类型安全的函数定义
async function processJob(data: VideoJobData): Promise<JobResult> {
  // ...
}
```

---

### 5. 日志工具（`src/utils/logger.ts`）

#### 导出内容

```typescript
// 日志级别枚举
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

// Logger 类
export class Logger {
  debug(message: string, meta?: any): void
  info(message: string, meta?: any): void
  warn(message: string, meta?: any): void
  error(message: string, meta?: any): void
  child(context: string): Logger
}

// 默认 logger 实例
export const logger: Logger

// 创建带上下文的 logger
export function createLogger(context: string): Logger
```

#### 使用示例

```typescript
import { logger, createLogger } from '../utils/logger'

// 使用默认 logger
logger.info('Server started', { port: 3000 })
logger.error('Failed to connect', { error: err.message })

// 创建带上下文的 logger
const routeLogger = createLogger('generate-route')
routeLogger.info('Request received', { concept: 'math' })
```

---

### 6. 错误工具（`src/utils/errors.ts`）

#### 导出内容

```typescript
// 错误类
export class AppError extends Error { ... }
export class ValidationError extends AppError { ... }
export class NotFoundError extends AppError { ... }
export class AuthenticationError extends AppError { ... }
export class ForbiddenError extends AppError { ... }
export class ConflictError extends AppError { ... }
export class InternalError extends AppError { ... }
export class ServiceUnavailableError extends AppError { ... }
export class TimeoutError extends AppError { ... }

// 工具函数
export function isAppError(error: any): error is AppError
export function isOperationalError(error: any): boolean
export function formatError(error: any): ErrorResponse
export function getStatusCode(error: any): number
```

#### 使用示例

```typescript
import { ValidationError, NotFoundError, formatError } from '../utils/errors'

// 抛出错误
if (!jobId) {
  throw new ValidationError('Job ID is required', { field: 'jobId' })
}

const job = await findJob(jobId)
if (!job) {
  throw new NotFoundError('Job not found', { jobId })
}

// 格式化错误
try {
  // ...
} catch (error) {
  const errorResponse = formatError(error)
  res.status(errorResponse.statusCode || 500).json(errorResponse)
}
```

---

### 7. 错误处理中间件（`src/middlewares/error-handler.ts`）

#### 导出内容

```typescript
// 错误处理中间件
export function errorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void

// 404 处理中间件
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void

// 异步路由包装器
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): (req: Request, res: Response, next: NextFunction) => void
```

#### 使用示例

```typescript
import { errorHandler, notFoundHandler, asyncHandler } from '../middlewares/error-handler'

// 在 Express 应用中使用
app.use(errorHandler)
app.use(notFoundHandler)

// 包装异步路由
router.get('/test', asyncHandler(async (req, res) => {
  const data = await someAsyncOperation()
  res.json(data)
}))
```

---

### 8. CORS 中间件（`src/middlewares/cors.ts`）

#### 导出内容

```typescript
// CORS 中间件实例
export const corsMiddleware: RequestHandler
```

#### 使用示例

```typescript
import { corsMiddleware } from '../middlewares/cors'

// 在 Express 应用中使用
app.use(corsMiddleware)
```

---

## 🎯 Part 2 集成指南（工兵 B）

### 你需要做什么

1. **创建 Express 应用入口**（`src/server.ts`）
   ```typescript
   import express from 'express'
   import { appConfig, validateConfig, printConfig } from './config/app'
   import { redisClient, checkRedisConnection } from './config/redis'
   import { videoQueue, closeQueue } from './config/bull'
   import { corsMiddleware } from './middlewares/cors'
   import { errorHandler, notFoundHandler } from './middlewares/error-handler'
   import { logger } from './utils/logger'
   
   // 验证配置
   validateConfig()
   
   // 创建 Express 应用
   const app = express()
   
   // 中间件
   app.use(express.json())
   app.use(corsMiddleware)
   
   // TODO: 挂载路由
   // app.use('/api', routes)
   
   // 错误处理
   app.use(notFoundHandler)
   app.use(errorHandler)
   
   // 启动服务器
   const server = app.listen(appConfig.port, appConfig.host, () => {
     printConfig()
     logger.info(`Server running on http://${appConfig.host}:${appConfig.port}`)
   })
   
   // 优雅关闭
   process.on('SIGTERM', async () => {
     logger.info('SIGTERM received, closing gracefully')
     server.close()
     await closeQueue()
     await redisClient.quit()
   })
   ```

2. **创建路由文件**
   - `src/routes/generate.route.ts` - 视频生成 API
   - `src/routes/job-status.route.ts` - 任务状态查询 API
   - `src/routes/health.route.ts` - 健康检查 API
   - `src/routes/index.ts` - 路由总入口

3. **改造 job-store 服务**
   - 修改 `src/services/job-store.ts`
   - 移除 `InternalStateManager` 依赖
   - 改用 `redisClient` 直接操作 Redis

### 关键集成点

```typescript
// 在路由中添加任务到队列
import { videoQueue } from '../config/bull'

const job = await videoQueue.add({
  jobId,
  concept,
  quality,
  timestamp: new Date().toISOString()
})

// 在 job-store 中使用 Redis
import { redisClient, REDIS_KEYS, generateRedisKey } from '../config/redis'

const key = generateRedisKey(REDIS_KEYS.JOB_RESULT, jobId)
await redisClient.set(key, JSON.stringify(result))
```

---

## 🎯 Part 3 集成指南（工兵 C）

### 你需要做什么

1. **创建队列目录结构**
   ```
   src/queues/
   ├── video.queue.ts           # 队列定义（已在 config/bull.ts）
   └── processors/
       └── video.processor.ts   # 任务处理器（你要创建）
   ```

2. **实现任务处理器**（`src/queues/processors/video.processor.ts`）
   ```typescript
   import { Job } from 'bull'
   import type { VideoJobData } from '../../types'
   import { logger } from '../../utils/logger'
   import { videoQueue } from '../../config/bull'
   
   // 注册处理器
   videoQueue.process(async (job: Job<VideoJobData>) => {
     const { jobId, concept, quality } = job.data
     
     logger.info('Processing job', { jobId })
     
     // TODO: 实现处理逻辑
     // 1. 检查缓存
     // 2. 分析概念
     // 3. 生成代码
     // 4. 渲染视频
     // 5. 存储结果
     
     return { success: true }
   })
   ```

3. **使用现有服务**
   - 所有业务逻辑在 `src/services/` 和 `src/events/` 中已经实现
   - 你只需要将它们组装成顺序调用
   - 使用 `logger` 替代 Motia logger
   - 使用 `redisClient` 替代 Motia state

---

## 📊 Redis 数据结构设计

### 任务结果存储

```
Key: job:result:{jobId}
Type: String (JSON)
TTL: 86400 秒（24 小时）
Value: {
  "status": "completed" | "failed",
  "data": { ... },
  "timestamp": 1234567890
}
```

### 概念缓存存储

```
Key: concept:cache:{hash}
Type: String (JSON)
TTL: 2592000 秒（30 天）
Value: {
  "jobId": "...",
  "conceptHash": "...",
  "videoUrl": "...",
  "manimCode": "...",
  "createdAt": 1234567890
}
```

---

## ✅ 检查点

在继续 Part 2/3 之前，请确认：

- [ ] 所有配置文件都能正常导入
- [ ] Redis 连接成功（运行 `redis-server` 测试）
- [ ] TypeScript 编译无错误（运行 `npm run build`）
- [ ] 类型定义完整且无冲突
- [ ] 日志和错误工具可正常使用

---

## 🆘 常见问题

### Q1: Redis 连接失败怎么办？
**A:** 确保 Redis 服务正在运行：
```bash
redis-server
# 或在 Docker 中
docker run -d -p 6379:6379 redis
```

### Q2: TypeScript 类型错误？
**A:** 确保安装了所有类型定义：
```bash
npm install --save-dev @types/bull @types/ioredis
```

### Q3: 如何测试配置是否正常？
**A:** 创建测试文件 `test-config.ts`：
```typescript
import { redisClient, checkRedisConnection } from './src/config/redis'
import { videoQueue, getQueueStats } from './src/config/bull'
import { logger } from './src/utils/logger'

async function test() {
  const redisOk = await checkRedisConnection(redisClient)
  logger.info('Redis connection', { ok: redisOk })
  
  const stats = await getQueueStats()
  logger.info('Queue stats', stats)
}

test()
```

---

## 📞 联系方式

如有问题，请在项目中提 Issue 或联系工兵 A。

---

*文档版本：v1.0*  
*创建时间：2026-01-19*  
*作者：工兵 A（Kilo Code AI）*