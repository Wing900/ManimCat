## 前言

很荣幸在这里介绍我的新项目ManimCat，它是~一只猫~

本项目由[manim-video-generator](https://github.com/rohitg00/manim-video-generator)二开而来，在此感谢原作者。

 ManimCat 是一个基于 AI 的数学动画生成平台，致力于让数学教师使用manim代码生成视频应用到课堂与教学之中。

用户只需输入自然语言描述，系统便会通过 AI 自动生成 Manim 代码并渲染出精美的数学可视化视频，支持 LaTeX 公式、模板化生成以及代码错误自动修复，让复杂概念的动态展示变得触手可及。

## 技术

### 技术栈

**后端**
- Express.js 4.18.0 + TypeScript 5.9.3
- Bull 4.16.5 + ioredis 5.9.2（Redis 任务队列）
- OpenAI SDK 4.50.0
- Zod 3.23.0（数据验证）

**前端**
- React 19.2.0 + TypeScript 5.9.3
- Vite 7.2.4
- TailwindCSS 3.4.19
- react-syntax-highlighter 16.1.0

**系统依赖**
- Python 3.11
- Manim Community Edition 0.18.0
- LaTeX（texlive）
- ffmpeg + Xvfb

**部署**
- Docker + Docker Compose
- Redis 7

### 技术路线

```
用户请求 → POST /api/generate
           ↓
       [认证中间件]
           ↓
       [Bull 任务队列]
           ↓
    ┌─────────────────────────┐
    │  视频生成处理器        │
    ├─────────────────────────┤
    │ 1. 检查概念缓存       │
    │ 2. 分析概念           │
    │    - LaTeX检测        │
    │    - 模板匹配         │
    │    - AI生成           │
    │ 3. 生成代码           │
    │ 4. 渲染视频           │
    │    - AI代码修复       │
    │ 5. 存储结果到Redis    │
    └─────────────────────────┘
           ↓
      前端轮询状态
           ↓
    GET /api/jobs/:jobId
```



## 贡献

我对原作品进行了一些修改和重构，使其更符合我的设计想法：

 1. 框架架构重构

  - 原项目：使用 Motia 事件驱动框架
  - 重构后：改为 Express.js + Bull 任务队列架构

  2. 前后端分离

  - 原项目：单体应用，前端是原生 public/index.html
  - 重构后：前后端分离，React + TypeScript + Vite 独立前端

  3. 存储方案升级

  - 原项目：内存存储
  - 重构后：Redis 存储（任务结果、状态、缓存，支持持久化）

  4. 任务队列系统

  - 原项目：Motia Event Steps 流程
  - 重构后：Bull + Redis 任务队列，支持重试、超时、指数退避

  5. 前端技术栈

  - 原项目：原生 HTML/JS
  - 重构后：React 19 + TailwindCSS + react-syntax-highlighter

  6. 项目结构

  - 原项目：motia/src/{api,events,services}/
  - 重构后：
    src/{config,middlewares,routes,services,queues,prompts,types,utils}/
    frontend/src/{components,hooks,lib,types}/

  7. 新增功能

  - CORS 配置中间件
  - 前端主题切换、设置模态框等组件

- 增加对第三方oai格式的请求支持
- 支持第三方自定义api

- 增加重试机制，增加前后端状态查询
- 重构UI，重构提示词

- 增加对第三方oai格式的请求支持
- 支持第三方自定义api
- 优化提示词管理系统

  ## 现状

目前仍在完善项目，这只是第一个预览版本。我将致力于设计出更好的提示词与fallback流程。目标是可以对一道高考数学题进行完整的可视化。以下是建设的计划：

- 优化提示词，生成更长篇幅的Manim代码和更精准的效果
- 增加调度和重试功能
- 增加一定的验证页面，以防止滥用
- 增加自定义模式功能，使用不同提示词生成不同视频
- 增加迭代功能，延长生成代码和视频长度

