简体中文 | [English](https://github.com/Wing900/ManimCat/blob/main/README.md)

<div align="center">

<!-- 顶部装饰线 - 统一为深灰色调 -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=455A64&height=120&section=header" />

<br>

<img src="public/logo.svg" width="200" alt="ManimCat Logo" />

<!-- 装饰：猫咪足迹 -->
<div style="opacity: 0.3; margin: 20px 0;">
  <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Animals/Paw%20Prints.png" width="40" alt="paws" />
</div>

<h1>
  <picture>
    <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=40&duration=3000&pause=1000&color=455A64&center=true&vCenter=true&width=435&lines=ManimCat+%F0%9F%90%BE" alt="ManimCat" />
  </picture>
</h1>

<!-- 装饰：数学符号分隔 -->
<p align="center">
  <span style="font-family: monospace; font-size: 24px; color: #90A4AE;">
    ∫ &nbsp; ∑ &nbsp; ∂ &nbsp; ∞
  </span>
</p>

<p align="center">
  <strong>🎬 AI-Powered Mathematical Animation Generator</strong>
</p>

<p align="center">
  让数学动画创作变得简单优雅 · 基于 Manim 与大语言模型
</p>

<!-- 装饰：几何点阵分隔 -->
<div style="margin: 30px 0;">
  <span style="color: #CFD8DC; font-size: 20px;">◆ &nbsp; ◆ &nbsp; ◆</span>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/ManimCE-0.19.2-455A64?style=for-the-badge&logo=python&logoColor=white" alt="ManimCE" />
  <img src="https://img.shields.io/badge/React-19.2.0-455A64?style=for-the-badge&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-18+-455A64?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-Mixed-607D8B?style=for-the-badge" alt="License" />
</p>

<p align="center" style="font-size: 18px;">
  <a href="#前言"><strong>前言</strong></a> •
  <a href="#样例"><strong>样例</strong></a> •
  <a href="#技术"><strong>技术</strong></a> •
  <a href="#部署"><strong>部署</strong></a> •
  <a href="#贡献"><strong>贡献</strong></a> •
  <a href="#思路"><strong>思路</strong></a> •
  <a href="#现状"><strong>现状</strong></a>
</p>

<br>

<!-- 底部装饰线 - 统一为深灰色调 -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=455A64&height=100&section=footer" />

</div>

<br>

## 前言

很荣幸在这里介绍我的新项目ManimCat，它是~一只猫~

本项目基于[manim-video-generator](https://github.com/rohitg00/manim-video-generator)架构级重构与二次开发而来，在此感谢原作者 Rohit Ghumare。我重写了整个前后端架构，解决了原版在并发和渲染稳定性上的痛点，并加以个人审美设计与应用的理想化改进。

 ManimCat 是一个基于 AI 的数学可视化生成平台，支持 `video` 与 `image` 两种输出模式，面向课堂教学与题目讲解场景。

用户只需输入自然语言描述，系统便会通过 AI 自动生成 Manim 代码，并按模式渲染为动画视频或多张静态图片。系统支持 LaTeX 公式、双阶段生成、错误修复重试，以及图片模式下的锚点分块渲染，适合做“逐步推导 + 数形结合”的教学内容。

### 界面

![image-20260221125910244](https://raw.githubusercontent.com/Wing900/ManimCat/main/public/readme-images/ui-1.png)

![image-20260221130027231](https://raw.githubusercontent.com/Wing900/ManimCat/main/public/readme-images/ui-2.png)

![image-20260221130809525](https://raw.githubusercontent.com/Wing900/ManimCat/main/public/readme-images/ui-3.png)

## 样例

<div align="center">

> *$1/4 + 1/16 + 1/64 + \dots = 1/3$，证明这个等式，美丽的图形方法，优雅的缩放平稳镜头移动，慢节奏，至少两分钟，逻辑清晰，奶黄色背景，马卡龙色系*

<br>

<a href="https://github.com/user-attachments/assets/38dba3ba-e29f-458d-b8ea-baf10cade4f1">
  <video src="https://github.com/user-attachments/assets/38dba3ba-e29f-458d-b8ea-baf10cade4f1" width="85%" autoplay loop muted playsinline>
  </video>
</a>

<sub>▲ 含背景音乐 · 几何级数证明 · ManimCat 生成</sub>

</div>


## 技术

### 技术栈

**后端**
- Express.js（`package.json`: `^4.18.0`，当前 `package-lock.json`: `4.22.1`）+ TypeScript `5.9.3`
- Bull `4.16.5` + ioredis `5.9.2`（Redis 任务队列）
- OpenAI SDK（`package.json`: `^4.50.0`，当前 `package-lock.json`: `4.104.0`）
- Zod（`package.json`: `^3.23.0`，当前 `package-lock.json`: `3.25.76`，数据验证）
- Supabase JS（`@supabase/supabase-js`）可选持久化历史记录存储

**前端**
- React（当前 lock 版本 `19.2.3`）+ TypeScript `5.9.3`
- Vite（`package.json`: `^7.2.4`，当前 lock 版本 `7.3.1`）
- TailwindCSS `3.4.19`
- react-syntax-highlighter `16.1.0`

**系统依赖**
- Python / Manim 运行时（Docker 基础镜像：`manimcommunity/manim:stable`）
- LaTeX（texlive）
- ffmpeg + Xvfb

**部署**
- Docker + Docker Compose
- Redis（容器内安装 `redis-server`，未在仓库中单独锁定主版本）

### 技术路线

```
用户请求 → POST /api/generate (outputMode: video | image)
           ↓
       [认证中间件]
           ↓
       [Bull 任务队列]
           ↓
    ┌─────────────────────────────────────────────┐
    │                生成处理器                    │
    ├─────────────────────────────────────────────┤
    │ 1. 概念分析                                  │
    │    - 统一走 AI（关闭模板快捷路径）            │
    │ 2. 两阶段生成                                │
    │    - 阶段1: 概念设计师                        │
    │    - 阶段2: 代码生成者                        │
    │ 3. 代码重试管理器（最多 4 次）                │
    │ 4. 按输出模式渲染                             │
    │    - video: 渲染 mp4                          │
    │    - image: 解析 YON_IMAGE 锚点并逐张渲染 PNG │
    │ 5. 存储结果与阶段耗时（Redis + 文件系统）      │
    └─────────────────────────────────────────────┘
           ↓
      前端轮询状态
           ↓
    GET /api/jobs/:jobId (video_url | image_urls)
```

**重试机制说明：**
- 概念设计师结果会保存，不需要重复设计
- 每次重试都发送完整的对话历史（原始提示词 + 历史代码 + 错误信息）
- 最多重试 4 次，失败后任务标记为失败

**图片模式说明：**
- 输出必须为 `YON_IMAGE_n` 锚点代码块，后端按锚点组数判定图片数量并逐张渲染。
- 任意一张渲染失败则整任务失败（严格模式）。
- 返回结果字段为 `image_urls`，视频模式返回 `video_url`。

### 环境变量配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `REDIS_HOST` | `localhost` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | - | Redis 密码（如需） |
| `REDIS_DB` | `0` | Redis 数据库 |
| `MANIMCAT_ROUTE_KEYS` | - | 按 ManimCat key 进行上游映射的 key 列表（逗号/换行分隔） |
| `MANIMCAT_ROUTE_API_URLS` | - | 上游 API 地址列表（与 `MANIMCAT_ROUTE_KEYS` 按索引配对） |
| `MANIMCAT_ROUTE_API_KEYS` | - | 上游 API 密钥列表（与 `MANIMCAT_ROUTE_KEYS` 按索引配对） |
| `MANIMCAT_ROUTE_MODELS` | - | 上游模型列表（与 `MANIMCAT_ROUTE_KEYS` 按索引配对）。留空表示禁用该 key（无可用模型） |
| `AI_TEMPERATURE` | `0.7` | 生成温度 |
| `AI_MAX_TOKENS` | `12000` | 最大输出 token 数 |
| `AI_THINKING_TOKENS` | `20000` | 最大思维链 token 数 |
| `DESIGNER_TEMPERATURE` | `0.8` | 设计师温度 |
| `DESIGNER_MAX_TOKENS` | `12000` | 设计师最大输出 token 数 |
| `DESIGNER_THINKING_TOKENS` | `20000` | 设计师最大思维链 token 数 |
| `REQUEST_TIMEOUT` | `600000` | 请求超时（毫秒） |
| `JOB_TIMEOUT` | `600000` | 任务超时（毫秒） |
| `MANIM_TIMEOUT` | `600000` | Manim 渲染超时（毫秒） |
| `LOG_LEVEL` | `info` | 日志级别（debug/info/warn/error） |
| `PROD_SUMMARY_LOG_ONLY` | `true` | 生产环境仅输出任务摘要日志（每任务一条） |
| `CODE_RETRY_MAX_RETRIES` | `4` | 代码修复重试次数 |
| `MEDIA_RETENTION_HOURS` | `72` | 图片/视频文件保留小时数 |
| `MEDIA_CLEANUP_INTERVAL_MINUTES` | `60` | 媒体清理任务执行间隔（分钟） |
| `JOB_RESULT_RETENTION_HOURS` | `24` | 任务结果与阶段信息保留小时数 |
| `USAGE_RETENTION_DAYS` | `90` | 用量统计（按天聚合）保留天数 |
| `METRICS_USAGE_RATE_LIMIT_MAX` | `30` | 用量接口每个 IP 的窗口最大请求数 |
| `METRICS_USAGE_RATE_LIMIT_WINDOW_MS` | `60000` | 用量接口限流窗口时长（毫秒） |
| `ENABLE_HISTORY_DB` | `false` | 是否启用持久化生成历史（需配置 Supabase） |
| `SUPABASE_URL` | - | Supabase 项目 URL |
| `SUPABASE_KEY` | - | Supabase anon key 或 service role key |

**示例 `.env` 文件：**

```bash
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
AI_TEMPERATURE=0.7
CODE_RETRY_MAX_RETRIES=4
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

**上游选择优先级（高 -> 低）**

1. 请求体 `customApiConfig`（前端“激活自定义”时）
2. `MANIMCAT_ROUTE_*` 命中当前 Bearer key

## 部署

请查看[部署文档](https://github.com/Wing900/ManimCat/blob/main/DEPLOYMENT.md)。

## 贡献

我对原作品进行了比较大量的修改和重构，使其更符合我的设计想法：

  1. 框架架构重构

  - 后端使用 Express.js + Bull 任务队列架构

  2. 前后端分离

  - 前后端分离，React + TypeScript + Vite 独立前端

  3. 存储方案升级

  - Redis 存储任务状态与结果（TTL 管理），不再使用概念缓存捷径

  4. 任务队列系统

  - Bull + Redis 任务队列，支持重试、超时、指数退避

  5. 前端技术栈

  - React 19 + TailwindCSS + react-syntax-highlighter

  6. 项目结构

  - src/{config,database,middlewares,routes,services,queues,prompts,types,utils}/
    frontend/src/{components,hooks,lib,types}/

  7. 新增功能

  - CORS 配置中间件

  - 新增图片输出模式（与视频模式并列）

  - 图片模式支持 `YON_IMAGE` 锚点分块、多图逐张渲染与画廊预览

  - 支持图片打包下载（全部下载）

  - 增加图片输入支持（参考图）

  - 简洁中国风的轻盈前端主题，支持双色切换、设置模态框等组件

  - 增加对第三方oai格式的请求支持，支持第三方自定义api

  - 增加重试机制，增加前后端状态查询

  - 增加前端自定义视频参数（仅视频模式生效）

  - 支持内存监控端点

  - 自定义提示词管理，新增专门的提示词管理页面，支持配置8种不同类型的提示词

  - 支持二次人工修改和渲染，支持二次AI修改

  - 增加计时功能，可查看各阶段耗时（图片/视频通用）

  - 增加后端test接口

  - 新增生产日志摘要模式（可按任务输出单条结果日志，支持 token 汇总）

  - 支持服务端按 ManimCat key 映射上游（可区分测试/正式用户）

  - 前端自定义 API 仍支持多组配置轮询分流（url/key/model/manimcat key 按索引配对）

  - 工作空间：统一的全屏管理页面，整合生成历史、提示词管理和用量统计，左侧 Rail 导航切换

  - 生成历史：持久化历史记录存储于 Supabase（仅存文字：提示词、代码、元数据；不存储视频/图片），通过 `ENABLE_HISTORY_DB` 环境变量开关

  - 背景音乐：视频渲染后自动混入钢琴 BGM（-20dB，随机选曲+随机起点，末尾 3 秒淡出），可在视频设置中开关

  - 独立的渲染失败事件采集与管理员 JSON 导出能力：可收集模型输出中的 Manim 失败代码片段，帮助定位问题并持续改进服务稳定性

  - 等待过程内置 2048 小游戏：用于缓解长时间渲染等待的无聊感



<details>
  <summary> 提示词功能说明</summary>



### 提示词类型

系统支持 **8 种提示词类型**，分为两个主要类别：

#### 系统级提示词（System）
- **conceptDesigner**：概念设计系统提示词 - 用于指导 AI 理解数学概念并设计动画场景
- **codeGeneration**：代码生成系统提示词 - 用于指导 AI 生成符合规范的 Manim 代码
- **codeRetry**：系统重试提示词 - 仅用于代码渲染失败后的修复阶段，系统本身不会 重试，只是进入修复流程时使用该系统提示词

#### 用户级提示词（User）
- **conceptDesigner**：概念设计用户提示词 - 补充说明概念设计的具体需求和风格
- **codeGeneration**：代码生成用户提示词 - 补充说明代码生成的具体要求和规范
- **codeRetryInitial**：代码修复初始重试提示词 - 代码第一次失败时的修复指导
- **codeRetryFix**：代码修复提示词 - 代码第二次失败时的详细修复指导

### 使用流程

1. **访问页面**：点击主界面右上角的”工作空间”按钮，然后在左侧 Rail 中选择”提示词系统”
2. **选择类型**：在侧边栏选择要编辑的提示词类型
3. **编辑提示词**：在主编辑区输入或修改提示词内容
4. **保存配置**：点击保存按钮或自动保存
5. **应用效果**：配置会自动应用到下一次生成任务

### 与主页面概念输入的关系

- **主页面输入**：每次生成动画时需要重新输入的**具体任务描述**
- **提示词管理**：一次配置，多次使用的**全局行为规则**
- **结合使用**：系统会将用户输入的概念与配置的提示词结合使用，生成符合要求的动画

### 提示词生效逻辑

- **默认优先级**：用户未修改时，使用后端默认提示词模板
- **覆盖优先级**：用户修改后，仅覆盖对应字段，其余继续使用默认值
- **重试阶段**：初次生成失败后进入修复流程，系统提示词使用 `codeRetry`，用户提示词使用 `codeRetryInitial`/`codeRetryFix`



</details>

##  开源与版权声明 

本项目授权细则见 `LICENSE_POLICY.md`。

*   第三方来源与归属说明见 `THIRD_PARTY_NOTICES.md`。
*   中文版第三方来源与归属说明见 `THIRD_PARTY_NOTICES.zh-CN.md`。

## 维护说明

由于作者精力有限（个人业余兴趣开发者，非专业背景），目前完全无法对外部代码进行有效的审查和长期维护。因此，本项目欢迎 PR，不过代码审查周期长。感谢理解。

如果你有好的建议或发现了 Bug，欢迎提交 Issue 进行讨论，我会根据自己的节奏进行改进。如果你希望在本项目基础上进行大规模修改，欢迎 Fork 出属于你自己的版本。

如果你觉得有启发与帮助，那是我的荣幸。


<details>
  <summary><b>如果你觉得这个作品很好，也欢迎请作者喝可乐🥤</b></summary>
  <br />
  <p>点击下方链接进行投喂：</p>
  <a href="https://afdian.com/a/wingflow/plan" target="_blank">
    <img src="https://img.shields.io/badge/赞助-爱发电-635cff?style=for-the-badge&logo=shopee&logoColor=white" alt="爱发电赞助" />
  </a>
  <p><i>感谢你的支持，我会更有动力维护这个项目！</i></p>
</details>

## 致谢

- 原项目作者
- Linux.do社区
- 阿里云百炼平台



