# Part 1: 基础设施层 - 接口文档

**MRE 重构工程 - 供 Part 2/3 使用**

---

## 目录

- [配置模块](#配置模块)
- [类型定义](#类型定义)
- [工具函数](#工具函数)
- [中间件](#中间件)
- [队列服务](#队列服务)
- [使用示例](#使用示例)

---

## 配置模块

### `src/config/app.ts`

应用全局配置，从环境变量读取。

```typescript
import { appConfig, validateConfig, isDevelopment, isProduction, printConfig } from './config/app'
```

#### 属性

| 属性 | 类型 | 环境变量 | 默认值 | 说明 |
|------|------|----------|--------|------|
| `appConfig.port` | number | `PORT` | 3000 | 服务器端口 |
| `appConfig.host` | string | `HOST` | 0.0.0.0 | 服务器地址 |
| `appConfig.nodeEnv` | string | `NODE_ENV` | development | 环境标识 |
| `appConfig.cors.origin` | string | `CORS_ORIGIN` | * | CORS 允许的来源 |
| `appConfig.cors.credentials` | boolean | - | true | 是否允许凭证 |
| `appConfig.logging.level` | string | `LOG_LEVEL` | info | 日志级别 |
| `appConfig.logging.pretty` | boolean | - | development 时 true | 格式化日志 |
| `appConfig.openai.apiKey` | string \| undefined | `OPENAI_API_KEY` | - | OpenAI API Key |
| `appConfig.openai.model` | string | `OPENAI_MODEL` | gpt-4.1-nano | AI 模型 |
| `appConfig.cache.enabled` | boolean | `ENABLE_CACHING` | true | 缓存开关 |
| `appConfig.cache.ttl` | number | `CACHE_TTL` | 2592000 | 缓存 TTL (30天) |
| `appConfig.manim.timeout` | number | `MANIM_TIMEOUT` | 300000 | Manim 超时 (5分钟) |

#### 方法

```typescript
// 验证必需的环境变量
validateConfig(): void
// 抛出错误：如果缺少 OPENAI_API_KEY

// 开发模式检查
isDevelopment(): boolean

// 生产模式检查
isProduction(): boolean

// 打印配置信息（隐藏敏感信息）
printConfig(): void
```

---

### `src/config/redis.ts`

Redis 连接配置。

```typescript
import { redisClient, checkRedisConnection, REDIS_KEYS, generateRedisKey } from './config/redis'
```

#### 常量

```typescript
// Redis 键名前缀
REDIS_KEYS.JOB_RESULT      // 'job:result:'      - 任务结果
REDIS_KEYS.CONCEPT_CACHE   // 'concept:cache:'   - 概念缓存
REDIS_KEYS.QUEUE_PREFIX    // 'bull:'            - Bull 队列前缀
```

#### 函数

```typescript
// 创建 Redis 客户端
function createRedisClient(): Redis

// 生成 Redis 键名
function generateRedisKey(prefix: string, id: string): string
// 示例: generateRedisKey(REDIS_KEYS.JOB_RESULT, 'abc') => 'job:result:abc'

// 检查 Redis 连接状态
async function checkRedisConnection(client: Redis): Promise<boolean>
```

#### 导出

```typescript
// 单例 Redis 客户端（用于一般操作）
export const redisClient: Redis
```

**注意**: Bull 队列使用独立的 Redis 客户端，详见 `bull.ts`

---

### `src/config/bull.ts`

Bull 任务队列配置。

```typescript
import { videoQueue, closeQueue, getQueueStats, cleanQueue, checkQueueHealth } from './config/bull'
```

#### 队列实例

```typescript
// 视频生成队列
export const videoQueue: Queue<VideoJobData>
```

#### 队列选项（默认）

- `attempts`: 3 次重试
- `backoff`: 指数退避，初始 2 秒
- `timeout`: 10 分钟
- `removeOnComplete`: false（保留完成记录）
- `removeOnFail`: false（保留失败记录）

#### 方法

```typescript
// 关闭队列
async function closeQueue(): Promise<void>

// 获取队列统计
async function getQueueStats(): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  total: number
}>

// 清理队列
async function cleanQueue(): Promise<void>
// 清理所有已完成和失败的任务

// 检查队列健康状态
async function checkQueueHealth(): Promise<boolean>
// 返回 true 如果失败任务 < 100
```

#### 事件监听

队列自动监听以下事件：

```typescript
videoQueue.on('error', (error) => { ... })
videoQueue.on('waiting', (jobId) => { ... })
videoQueue.on('active', (job) => { ... })
videoQueue.on('completed', (job, result) => { ... })
videoQueue.on('failed', (job, err) => { ... })
videoQueue.on('progress', (job, progress) => { ... })
videoQueue.on('stalled', (job) => { ... })
```

---

## 类型定义

### `src/types/index.ts`

#### 基础类型

```typescript
// 视频质量选项
type VideoQuality = 'low' | 'medium' | 'high'

// 任务状态
type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

// 生成类型
type GenerationType = 'template' | 'ai' | 'cached'
```

#### 任务数据

```typescript
// 视频生成任务数据（Bull 队列使用）
interface VideoJobData {
  jobId: string
  concept: string
  quality: VideoQuality
  forceRefresh?: boolean
  timestamp: string
}
```

#### API 请求/响应

```typescript
// 生成请求
interface GenerateRequest {
  concept: string
  quality?: VideoQuality
  forceRefresh?: boolean
}

// 生成响应
interface GenerateResponse {
  success: boolean
  jobId: string
  message: string
  status: 'processing'
}

// 任务状态响应（联合类型）
type JobStatusResponse = 
  | JobStatusProcessingResponse 
  | JobStatusCompletedResponse 
  | JobStatusFailedResponse

// 处理中/排队
interface JobStatusProcessingResponse {
  status: 'processing' | 'queued'
  jobId: string
  message: string
}

// 完成
interface JobStatusCompletedResponse {
  status: 'completed'
  jobId: string
  data: {
    videoUrl: string
    manimCode: string
    usedAI: boolean
    quality: VideoQuality
    generationType: GenerationType
  }
}

// 失败
interface JobStatusFailedResponse {
  status: 'failed'
  jobId: string
  error: string
  details?: string
}
```

#### 健康检查

```typescript
interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down'
  timestamp: string
  services: {
    redis: boolean
    queue: boolean
    openai: boolean
  }
  stats?: {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
    total: number
  }
}
```

---

## 工具函数

### `src/utils/logger.ts`

统一日志工具。

```typescript
import { logger, createLogger } from './utils/logger'
```

#### 方法

```typescript
// 调试日志
logger.debug(message: string, context?: LogContext): void

// 信息日志
logger.info(message: string, context?: LogContext): void

// 警告日志
logger.warn(message: string, context?: LogContext): void

// 错误日志
logger.error(message: string, context?: LogContext): void

// HTTP 请求日志
logger.http(method: string, path: string, statusCode: number, duration?: number): void

// 创建带上下文的 logger
function createLogger(context: string): Logger
```

#### LogContext

```typescript
interface LogContext {
  [key: string]: any
}
```

---

### `src/utils/errors.ts`

统一错误处理工具。

```typescript
import { 
  AppError, 
  ValidationError, 
  NotFoundError, 
  AuthenticationError,
  ForbiddenError,
  InternalError,
  ServiceUnavailableError,
  TimeoutError,
  isAppError,
  isOperationalError,
  formatError,
  getStatusCode
} from './utils/errors'
```

#### 错误类

```typescript
// 基类
class AppError extends Error {
  statusCode: number
  isOperational: boolean
  details?: any
  toJSON(): ErrorResponse
}

// 验证错误 (400)
class ValidationError extends AppError

// 未找到 (404)
class NotFoundError extends AppError

// 认证错误 (401)
class AuthenticationError extends AppError

// 权限错误 (403)
class ForbiddenError extends AppError

// 内部错误 (500)
class InternalError extends AppError

// 服务不可用 (503)
class ServiceUnavailableError extends AppError

// 超时错误 (504)
class TimeoutError extends AppError
```

#### 工具函数

```typescript
// 判断是否为应用错误
function isAppError(error: any): error is AppError

// 判断是否为操作性错误（可恢复）
function isOperationalError(error: any): boolean

// 格式化错误响应
function formatError(error: any): ErrorResponse

// 从错误中提取状态码
function getStatusCode(error: any): number
```

---

## 中间件

### `src/middlewares/error-handler.ts`

Express 错误处理中间件。

```typescript
import { errorHandler, notFoundHandler, asyncHandler } from './middlewares/error-handler'
```

#### 函数

```typescript
// 错误处理中间件
function errorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void

// 404 处理
function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void

// 异步路由包装器
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): (req: Request, res: Response, next: NextFunction) => void
```

#### 使用方式

```typescript
// Express 应用中使用
app.use(notFoundHandler)
app.use(errorHandler)

// 异步路由包装
app.get('/api/data', asyncHandler(async (req, res, next) => {
  // 如果抛出错误，会自动被 errorHandler 捕获
}))
```

---

### `src/middlewares/cors.ts`

CORS 配置。

```typescript
import { corsMiddleware } from './middlewares/cors'
```

```typescript
// 使用方式
app.use(corsMiddleware)
```

配置来自 `appConfig.cors`：
- `origin`: `CORS_ORIGIN` 环境变量
- `credentials`: true
- `methods`: GET, POST, PUT, DELETE, OPTIONS
- `allowedHeaders`: Content-Type, Authorization, X-Requested-With, Accept, Origin
- `maxAge`: 86400 (24小时)

---

## 队列服务

### 添加任务

```typescript
import { videoQueue } from './config/bull'
import type { VideoJobData } from './types'

const jobData: VideoJobData = {
  jobId: 'uuid-here',
  concept: 'Pythagorean theorem',
  quality: 'low',
  timestamp: new Date().toISOString()
}

const job = await videoQueue.add(jobData, {
  jobId: jobData.jobId,  // 使用自定义 jobId
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 }
})

console.log('Job added:', job.id)
```

### 获取任务状态

```typescript
const job = await videoQueue.getJob(jobId)

if (job) {
  console.log('Status:', job.progress())
  console.log('Data:', job.returnvalue)
}
```

### 任务进度更新

```typescript
// 在任务处理器中
job.progress(50)  // 更新进度为 50%
```

---

## 使用示例

### Part 2: API 路由示例

```typescript
import express from 'express'
import { videoQueue } from '../config/bull'
import { asyncHandler } from '../middlewares/error-handler'
import { logger } from '../utils/logger'
import type { GenerateRequest, VideoJobData } from '../types'

const router = express.Router()

router.post('/generate', asyncHandler(async (req, res) => {
  const { concept, quality = 'low' } = req.body as GenerateRequest

  const jobId = crypto.randomUUID()
  const jobData: VideoJobData = {
    jobId,
    concept,
    quality,
    timestamp: new Date().toISOString()
  }

  await videoQueue.add(jobData, { jobId })

  logger.info('Job queued', { jobId, concept })

  res.status(202).json({
    success: true,
    jobId,
    status: 'processing'
  })
}))

export default router
```

### Part 3: 任务处理器示例

```typescript
import { videoQueue } from '../config/bull'
import { logger } from '../utils/logger'
import type { VideoJobData } from '../types'

videoQueue.process(async (job) => {
  const data = job.data as VideoJobData
  
  logger.info('Processing job', { jobId: data.jobId })
  
  // 业务逻辑...
  
  return { success: true, videoUrl: '/videos/xxx.mp4' }
})
```

---

## 环境变量

### 必需

```bash
OPENAI_API_KEY=your-openai-api-key
```

### 可选

```bash
# 服务器
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# CORS
CORS_ORIGIN=*

# 日志
LOG_LEVEL=info

# OpenAI
OPENAI_MODEL=gpt-4.1-nano

# 缓存
ENABLE_CACHING=true
CACHE_TTL=2592000

# Manim
MANIM_TIMEOUT=300000
```

---

## 验证

运行测试脚本验证基础设施：

```bash
npx tsx src/test-infrastructure.ts
```

期望输出：
- ✅ Redis connection test PASSED（Redis 运行时）
- ✅ Bull queue test PASSED
- ✅ Part 1 is ready for Part 2/3 usage

---

*文档版本: v1.0*  
*作者: 工兵 A (Part 1 负责人)*
