---
title: ManimCat
emoji: 🐱
colorFrom: gray
colorTo: blue
sdk: docker
sdk_version: "3.10"
app_file: start-with-redis-hf.cjs
pinned: false
---

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
  <img src="https://img.shields.io/badge/License-MIT-607D8B?style=for-the-badge" alt="License" />
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

### 01

> 用双栏布局，解释正弦函数的拉伸变换和解析式的关系

<div align="center">   <video src="https://github.com/user-attachments/assets/56528268-972d-45f6-9145-0531337cbffa" width="80%" autoplay loop muted playsinline>   </video>   <p><i>example01</i></p> </div>

### 02

> 画一个单位圆并且生成正弦函数

<div align="center">

  <video src="https://github.com/user-attachments/assets/0fa7b853-7388-466c-ae46-93cf009277c4" width="80%" autoplay loop muted playsinline>
  </video>
  <p><i>example02</i></p>
</div>


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
- Manim Community Edition 0.19.2
- LaTeX（texlive）
- ffmpeg + Xvfb

**部署**
- Docker + Docker Compose
- Redis 7

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
| `OPENAI_API_KEY` | - | OpenAI API Key（必填） |
| `OPENAI_MODEL` | `glm-4-flash` | OpenAI 模型 |
| `OPENAI_TIMEOUT` | `600000` | OpenAI 请求超时（毫秒） |
| `CUSTOM_API_URL` | - | 自定义 OpenAI 兼容 API |
| `MANIMCAT_API_KEY` | - | API 访问密钥（可选） |
| `AI_TEMPERATURE` | `0.7` | 生成温度 |
| `AI_MAX_TOKENS` | `1200` | 生成最大 tokens |
| `DESIGNER_TEMPERATURE` | `0.8` | 设计师温度 |
| `DESIGNER_MAX_TOKENS` | `12000` | 设计师最大 tokens |
| `REQUEST_TIMEOUT` | `600000` | 请求超时（毫秒） |
| `JOB_TIMEOUT` | `600000` | 任务超时（毫秒） |
| `MANIM_TIMEOUT` | `600000` | Manim 渲染超时（毫秒） |
| `CODE_RETRY_MAX_RETRIES` | `4` | 代码修复重试次数 |
| `MEDIA_RETENTION_HOURS` | `72` | 图片/视频文件保留小时数 |
| `MEDIA_CLEANUP_INTERVAL_MINUTES` | `60` | 媒体清理任务执行间隔（分钟） |

**示例 `.env` 文件：**

```bash
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
OPENAI_API_KEY=your-api-key-here
OPENAI_MODEL=glm-4-flash
OPENAI_TIMEOUT=600000
AI_TEMPERATURE=0.7
CODE_RETRY_MAX_RETRIES=4
```

## 部署

请查看[部署文档](DEPLOYMENT.md)。

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

  - src/{config,middlewares,routes,services,queues,prompts,types,utils}/
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

1. **访问页面**：点击主界面右上角的“提示词管理”按钮（文档图标）
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

### 1. 软件协议 
本项目后端架构及前端部分实现参考/使用了 [manim-video-generator](https://github.com/rohitg00/manim-video-generator) 的核心思想。
*   继承部分代码遵循 **MIT License**。
*   本项目新增的重构代码、任务队列逻辑及前端组件，同样以 **MIT License** 向开源社区开放。

### 2. 核心资产版权声明 

**以下内容为本人（ManimCat 作者）原创，严禁任何形式的商用行为：**

*   **提示词工程**：本项目中 `src/prompts/` 目录下所有高度优化的 Manim 代码生成提示词及逻辑，均为本人原创。
*   **API Index Data**：本人自行爬取、清洗并制作的 Manim v0.18.2 API 索引表及相关强约束规则。
*   **特定算法逻辑**：针对思考模型的正则清理算法及 fallback 容错机制。

**未经本人书面许可，任何人不得将上述“核心资产”用于：**
1.  直接打包作为付费产品销售。
2.  集成在付费订阅制的商业 AI 服务中。
3.  在未注明出处的情况下进行二次分发并获利。

> 事实上，作者已经关注到市面上存在一些闭源商业项目，正利用类似的 AI + Manim 思路向数学教育工作者收取高额费用进行盈利。然而，开源社区目前仍缺乏针对教育场景深度优化的成熟项目。

> ManimCat 的诞生正是为了对标并挑战这些闭源商业软件。 我希望通过开源的方式，让每一位老师都能廉价地享受到 AI 带来的教学可视化便利————你只需要支付api的费用，幸运的是，对于优秀的中国LLM大模型来说，这些花费很廉价。为了保护这一愿景不被商业机构剽窃并反向收割用户，我坚决禁止任何对本项目核心提示词及索引数据的商业授权。

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


