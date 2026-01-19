# MRE 分工计划：三兵种协同作战方案

**Migration Refactoring Engineering - Team Division Plan**

---

## 🎖️ 作战部署总览

### 兵种分工
- **🔍 侦察兵（Scout）**：负责信息收集和代码审查
- **⚙️ 工兵 Part 1（Engineer A - 我）**：负责基础设施和配置层
- **💻 工兵 Part 2（Engineer B）**：负责 API 路由层迁移
- **🔧 工兵 Part 3（Engineer C）**：负责任务处理器和部署

---

## 📋 侦察任务清单

### 🔍 侦察兵任务（优先执行）

侦察兵需要收集以下关键信息，为后续三个工兵提供作战情报：

#### 1️⃣ 代码结构侦查
```bash
# 需要读取并分析的文件
- src/api/job-status.step.ts          # API 路由实现
- src/api/health.step.ts              # 健康检查实现
- src/events/analyze-concept.step.ts  # 概念分析逻辑
- src/events/generate-code.step.ts    # 代码生成逻辑
- src/events/handle-cache-hit.step.ts # 缓存命中处理
- src/events/store-result.step.ts     # 结果存储逻辑
- src/middlewares/core.middleware.ts  # 中间件实现
- src/middlewares/auth.middleware.ts  # 认证中间件
- src/services/concept-cache.ts       # 缓存服务详情
- src/services/manim-templates.ts     # 模板系统详情
```

#### 2️⃣ 环境配置侦查
```bash
# 需要查看的配置文件
- .env.example                        # 环境变量模板
- motia.config.ts                     # Motia 配置
- docker-compose.yml                  # Docker 编排配置
- Dockerfile                          # 容器构建配置
```

#### 3️⃣ 依赖关系侦查
- 当前 Motia 框架的具体使用模式
- 状态管理（`InternalStateManager`）的详细用法
- 事件发射（`emit`）和订阅（`subscribes`）的实现细节
- 中间件链的执行顺序和依赖关系

#### 4️⃣ 输出侦查报告
侦察兵完成后，需要提供：
- 📄 **代码结构分析报告**：哪些代码可以直接复用，哪些需要改造
- 📄 **依赖关系图**：各模块之间的调用关系
- 📄 **关键代码片段**：需要特别注意的逻辑实现
- 📄 **潜在风险点**：可能遇到的技术难点

---

## ⚙️ Part 1：基础设施层（工兵 A - 我负责）

### 目标
搭建 Express + Bull + Redis 的基础架构，为后续开发提供稳固底座。

### 📦 任务清单

#### 1.1 依赖管理
```bash
# 安装新依赖
npm install bull ioredis cors dotenv

# 移除旧依赖
npm uninstall motia redis-server
```

#### 1.2 创建配置文件

**文件：`src/config/redis.ts`**
```typescript
// Redis 连接配置
// - 支持本地开发和生产环境
// - 连接池管理
// - 错误处理
```

**文件：`src/config/bull.ts`**
```typescript
// Bull 队列配置
// - 队列定义
// - 任务重试策略
// - 并发控制
```

**文件：`src/config/app.ts`**
```typescript
// 应用全局配置
// - 端口、环境变量
// - 超时设置
// - 日志配置
```

#### 1.3 创建类型定义

**文件：`src/types/index.ts`**
```typescript
// 全局类型定义
// - Job 数据结构
// - API 请求/响应类型
// - 队列任务类型
```

#### 1.4 创建工具函数

**文件：`src/utils/logger.ts`**
```typescript
// 统一日志工具
// - 替代 Motia logger
// - 结构化日志输出
```

**文件：`src/utils/errors.ts`**
```typescript
// 错误处理工具
// - 统一错误格式
// - 错误码定义
```

#### 1.5 创建中间件

**文件：`src/middlewares/error-handler.ts`**
```typescript
// Express 错误处理中间件
// - 统一错误响应格式
// - 日志记录
```

**文件：`src/middlewares/cors.ts`**
```typescript
// CORS 配置中间件
```

#### 1.6 更新 package.json
```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "echo \"Tests coming soon\""
  }
}
```

### ✅ 交付物
- ✅ 所有配置文件创建完成
- ✅ 类型定义和工具函数就绪
- ✅ 基础中间件实现
- ✅ package.json 更新完成
- ✅ **提供详细的接口文档**供 Part 2/3 使用

---

## 💻 Part 2：API 路由层（工兵 B）

### 前置依赖
- ✅ Part 1 完成（配置和基础设施就绪）
- ✅ 侦察兵报告（了解原有 API 实现）

### 📦 任务清单

#### 2.1 创建 Express 应用入口

**文件：`src/server.ts`**
```typescript
// Express 应用主入口
// - 中间件配置
// - 路由挂载
// - 错误处理
// - 优雅关闭
```

#### 2.2 迁移 API 路由

**文件：`src/routes/generate.route.ts`**
```typescript
// 迁移自 src/api/generate.step.ts
// 改动点：
// - 移除 Motia handler 包装
// - 使用 Express Router
// - emit() → bullQueue.add()
// - Zod 验证保持不变
```

**文件：`src/routes/job-status.route.ts`**
```typescript
// 迁移自 src/api/job-status.step.ts
// 改动点：
// - 从 Redis 读取状态（而非 Motia State）
// - 使用 getJobResult() 函数
```

**文件：`src/routes/health.route.ts`**
```typescript
// 迁移自 src/api/health.step.ts
// 增强功能：
// - Redis 连接状态
// - Bull 队列状态
// - 系统资源状态
```

**文件：`src/routes/index.ts`**
```typescript
// 路由总入口
// - 统一挂载所有路由
// - API 版本控制
```

#### 2.3 改造服务层

**文件：`src/services/job-store.ts`**
```typescript
// 改造点：
// - 移除 InternalStateManager 依赖
// - 使用 ioredis 直接操作 Redis
// - 接口保持兼容，方便业务代码无感知迁移
```

### ✅ 交付物
- ✅ Express 应用可启动
- ✅ 3 个 API 端点正常工作
- ✅ job-store 服务改造完成
- ✅ **提供 API 测试用例**（curl 命令或 Postman 集合）

---

## 🔧 Part 3：任务处理器和部署（工兵 C）

### 前置依赖
- ✅ Part 1 完成（配置和基础设施就绪）
- ✅ Part 2 完成（API 路由和 job-store 改造）
- ✅ 侦察兵报告（了解事件处理流程）

### 📦 任务清单

#### 3.1 创建 Bull 队列

**文件：`src/queues/video.queue.ts`**
```typescript
// Bull 队列定义
// - 队列初始化
// - 任务添加接口
// - 事件监听（completed、failed、progress）
```

#### 3.2 创建任务处理器

**文件：`src/queues/processors/video.processor.ts`**
```typescript
// 整合以下 Motia Event Steps：
// 1. check-cache.step.ts       → checkCacheStep()
// 2. analyze-concept.step.ts   → analyzeConceptStep()
// 3. generate-code.step.ts     → generateCodeStep()
// 4. render-video.step.ts      → renderVideoStep()
// 5. store-result.step.ts      → storeResultStep()
// 6. handle-cache-hit.step.ts  → handleCacheHitStep()

// 改动点：
// - 移除 emit() 调用，改为函数调用
// - 移除 InternalStateManager，改为 Redis
// - 保持业务逻辑 100% 不变
```

#### 3.3 更新 Docker 配置

**文件：`Dockerfile`**
```dockerfile
# 移除 motia 安装
# 其他保持不变
# 启动命令改为：CMD ["node", "dist/server.js"]
```

**文件：`docker-compose.yml`**
```yaml
# Redis 配置保持不变
# manim-generator 服务启动命令改为 npm start
```

**文件：`.dockerignore`**
```
# 更新忽略文件列表
```

#### 3.4 云部署配置

**文件：`zeabur.json`**
```json
// 如需更新部署配置
```

### ✅ 交付物
- ✅ 任务处理器完整实现
- ✅ Docker 镜像构建成功
- ✅ 本地 docker-compose 测试通过
- ✅ **提供完整的部署文档**

---

## 🔄 协同工作流程

### 第一阶段：侦察（0.5 小时）
1. 🔍 **侦察兵**执行所有侦察任务
2. 输出侦查报告和关键代码片段
3. 为三个工兵提供作战情报

### 第二阶段：并行施工（2 小时）
1. ⚙️ **工兵 A（我）**：独立完成 Part 1
   - 不依赖其他部分
   - 完成后提供接口文档
   
2. 💻 **工兵 B**：等待 Part 1 完成后开始 Part 2
   - 依赖 Part 1 的配置文件
   - 完成后提供 API 测试用例

3. 🔧 **工兵 C**：等待 Part 1 + Part 2 完成后开始 Part 3
   - 依赖 Part 1 的配置和 Part 2 的 job-store
   - 完成后进行集成测试

### 第三阶段：集成测试（1 小时）
1. 三个工兵协同验证
2. 端到端功能测试
3. 性能和稳定性测试

---

## 📊 时间估算

| 阶段 | 负责人 | 预计时间 | 依赖关系 |
|------|--------|----------|----------|
| 侦察 | 侦察兵 | 0.5 小时 | 无 |
| Part 1 | 工兵 A（我） | 1 小时 | 侦察完成 |
| Part 2 | 工兵 B | 1 小时 | Part 1 完成 |
| Part 3 | 工兵 C | 1.5 小时 | Part 1 + Part 2 完成 |
| 集成测试 | 全体 | 1 小时 | 所有 Part 完成 |
| **总计** | | **5 小时** | |

---

## 🎯 交接标准

### Part 1 → Part 2 交接
- ✅ 所有配置文件创建完成且测试通过
- ✅ 类型定义文档清晰
- ✅ Redis 和 Bull 连接正常
- ✅ 提供示例代码演示如何使用

### Part 2 → Part 3 交接
- ✅ Express 应用启动正常
- ✅ API 端点可访问
- ✅ job-store 服务工作正常
- ✅ 提供 API 调用示例

### Part 3 → 集成测试
- ✅ 任务处理器完整实现
- ✅ Docker 构建成功
- ✅ 本地测试通过

---

## ⚠️ 关键风险点

### 技术风险
1. **Redis 状态迁移**：从 Motia State 到 Redis 的数据结构变化
   - 缓解：提前设计好 Redis key 命名规范
   
2. **事件流改造**：从 emit 到函数调用的逻辑转换
   - 缓解：保持业务逻辑不变，只改变调用方式

3. **并发处理**：Bull 队列的并发和重试机制
   - 缓解：使用 Bull 默认配置，后续优化

### 协同风险
1. **接口不匹配**：Part 1/2/3 之间的接口对接问题
   - 缓解：Part 1 提供详细的接口文档和类型定义
   
2. **进度不同步**：某个 Part 延期影响后续
   - 缓解：采用异步并行 + 检查点机制

---

## 📝 检查点机制

### Checkpoint 1：侦察完成
- [ ] 代码结构分析报告完成
- [ ] 依赖关系图绘制完成
- [ ] 关键代码片段提取完成
- [ ] 风险点识别完成

### Checkpoint 2：Part 1 完成
- [ ] 配置文件创建且可用
- [ ] 类型定义完整
- [ ] Redis 连接测试通过
- [ ] Bull 队列初始化成功

### Checkpoint 3：Part 2 完成
- [ ] Express 应用启动
- [ ] 3 个 API 端点响应正常
- [ ] job-store 单元测试通过

### Checkpoint 4：Part 3 完成
- [ ] 任务处理器逻辑完整
- [ ] Docker 镜像构建成功
- [ ] 本地 docker-compose 运行正常

### Checkpoint 5：集成测试完成
- [ ] 端到端生成视频成功
- [ ] 缓存机制工作正常
- [ ] 错误处理完善
- [ ] 性能指标达标

---

## 🎖️ 作战口号

**"分工明确，各司其职，协同作战，攻无不克！"**

---

*文档版本：v1.0*  
*创建时间：2026-01-19*  
*作者：Kilo Code AI - 工兵 A*