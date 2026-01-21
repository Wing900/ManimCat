- 本项目由二开而来
- 重构Motia为Express.js框架
- 增加重试机制，增加前后端状态查询
- 重构UI，重构提示词
- 删除了预设例子 

- 增加对第三方oai格式的请求支持
- 支持第三方自定义api
- 优化提示词管理系统
- 

  🔒 安全性问题

  1. 认证中间件未使用 (src/middlewares/auth.middleware.ts)

    - 已实现的 authMiddleware 从未应用到任何路由
    - 任何人都可以调用 API，无访问控制
  2. 无速率限制

    - /api/generate 和 /api/jobs/:id 容易被滥用
    - 可能导致 OpenAI API 成本失控
  3. 输入验证不足 (src/routes/generate.route.ts:38)
    concept: z.string().min(1)  // 只检查最小长度，无上限

    - concept 字段可接受极长输入，可能导致内存溢出
  4. UUID 格式未验证 (src/routes/job-status.route.ts:9)

    - jobId 不验证是否为有效 UUID，可能被滥用
  5. 环境变量配置不完整 (src/config/app.ts:15)
    const required = ['OPENAI_API_KEY']

    - 只验证 OPENAI_API_KEY，其他依赖（如 REDIS_HOST）无验证
  6. 错误信息泄露 (src/middlewares/error-handler.ts:42)

    - 开发环境返回完整错误堆栈，生产环境可能泄露敏感信息

  ⚡ 可靠性问题

  1. Redis 单点故障

    - 无Redis集群或哨兵配置
    - Redis重启可能导致任务丢失
  2. 视频文件无限增长

    - public/videos/ 目录无清理机制
    - 长期运行会占用大量磁盘空间
  3. 临时文件残留风险 (src/queues/processors/video.processor.ts:185)
    const tempDir = path.join(os.tmpdir(), `manim-${jobId}`)

    - 异常情况下临时目录可能未清理
  4. 轮询超时固定 (frontend/src/hooks/useGeneration.ts:50)
    const MAX_POLL_COUNT = 120  // 硬编码 2 分钟

    - 复杂动画渲染时间可能超过 2 分钟

  🎯 架构设计问题

  1. 前后端类型不同步风险

    - frontend/src/types/api.ts 和 src/types/index.ts 分别定义相同类型
    - 容易出现不一致
  2. AI 修复重试硬编码 (src/services/ai-code-fix.ts:7)
    export const MAX_RETRIES = 3

    - 重试次数和策略不可配置
  3. 队列 worker 数量未配置

    - 默认单 worker，高并发下成为瓶颈

  📝 其他问题

  1. 缺少监控和日志聚合

    - 只有基础 console.log，无结构化日志
    - 无 metrics/trace 支持
  2. 健康检查不完整 (src/routes/health.route.ts:34)

    - 只检查连接状态，不检查 Manim/ffmpeg 是否可用

  3. .env.example 缺少重要变量
