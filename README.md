<div align="center">
  <img src="public/logo.svg" width="150" alt="ManimCat Logo" />
  <br><br>
  <img src="https://img.shields.io/badge/ManimCE-0.19.2-blue" alt="ManimCE" />
  <img src="https://img.shields.io/badge/React-19.2.0-61dafb" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-18+-green" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
</div>

## 目录

- [前言](#前言)
- [样例](#样例)
- [技术](#技术)
- [部署](#部署)
- [贡献](#贡献)
- [思路](#思路)
- [现状](#现状)
- [开源与版权声明](#开源与版权声明-license--copyright)
- [维护说明](#维护说明)

## 前言

很荣幸在这里介绍我的新项目ManimCat，它是~一只猫~

本项目基于[manim-video-generator](https://github.com/rohitg00/manim-video-generator)架构级重构与二次开发而来，在此感谢原作者 Rohit Ghumare。我重写了整个前后端架构，解决了原版在并发和渲染稳定性上的痛点，并加以个人审美设计与应用的理想化改进。

 ManimCat 是一个基于 AI 的数学动画生成平台，致力于让数学教师使用manim代码生成视频应用到课堂与教学之中。

用户只需输入自然语言描述，系统便会通过 AI 自动生成 Manim 代码并渲染出精美的数学可视化视频，支持 LaTeX 公式、模板化生成以及代码错误自动修复，让复杂概念的动态展示变得触手可及。


## 样例

期待ing！

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

## 部署

请查看[部署文档](DEPLOYMENT.md)。

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

  - 重构框架，后端抛弃motia框架代之以express.js框架，前端改用React

  - CORS 配置中间件

  - 前端主题切换、设置模态框等组件

  - 增加对第三方oai格式的请求支持

  - 支持第三方自定义api

  - 增加重试机制，增加前后端状态查询

  - 重构UI，重构提示词，采取强注入manim api规范的方式

  - 增加前端自定义视频参数

  - 支持内存查询端点

  - 优化提示词管理系统

  - 对AI的输出结合提示词进行高度优化的正则清理，适配思考模型

  ## 思路

  1. 在原作者使用AI一键生成manim视频并且后端渲染的基础上，增加了fallback机制，提升弱模型的生成完成度

  2. 考虑到多数AI的manim语料训练并不多，为了降低AI幻觉率，采用提示词工程的方法，强注入manimv0.19.2的api索引表知识（自行爬取清洗制作）

  ## 现状

目前仍在完善项目，这只是第一个预览版本。我将致力于设计出更好的提示词与fallback流程。目标是可以对一道中国高考数学题进行完整的可视化。以下是建设的计划：

- 优化提示词，生成更长篇幅的Manim代码和更精准的效果
- 增加调度和重试功能 
- 增加一定的验证页面，以防止滥用 （已经完成）
- 增加自定义模式功能，使用不同提示词生成不同视频
- 增加迭代功能，延长生成代码和视频长度
- 提供可能的打包版本，让非开发者可以本地实现项目

##  开源与版权声明 (License & Copyright)

### 1. 软件协议 (Software License)
本项目后端架构及前端部分实现参考/使用了 [manim-video-generator](https://github.com/rohitg00/manim-video-generator) 的核心思想。
*   继承部分代码遵循 **MIT License**。
*   本项目新增的重构代码、任务队列逻辑及前端组件，同样以 **MIT License** 向开源社区开放。

### 2. 核心资产版权声明 (Core Assets - **PROHIBITED FOR COMMERCIAL USE**)
**以下内容为本人（ManimCat 作者）原创，严禁任何形式的商用行为：**

*   **Prompt Engineering（提示词工程）**：本项目中 `src/prompts/` 目录下所有高度优化的 Manim 代码生成提示词及逻辑，均为本人原创。
*   **API Index Data**：本人自行爬取、清洗并制作的 Manim v0.18.2 API 索引表及相关强约束规则。
*   **特定算法逻辑**：针对思考模型的正则清理算法及 fallback 容错机制。

**未经本人书面许可，任何人不得将上述“核心资产”用于：**
1.  直接打包作为付费产品销售。
2.  集成在付费订阅制的商业 AI 服务中。
3.  在未注明出处的情况下进行二次分发并获利。

> 事实上，作者已经关注到市面上存在一些闭源商业项目，正利用类似的 AI + Manim 思路向数学教育工作者收取高额费用进行盈利。然而，开源社区目前仍缺乏针对教育场景深度优化的成熟项目。

> ManimCat 的诞生正是为了对标并挑战这些闭源商业软件。 我希望通过开源的方式，让每一位老师都能廉价地享受到 AI 带来的教学可视化便利————你只需要支付api的费用，幸运的是，对于优秀的中国LLM大模型来说，这些花费很廉价。为了保护这一愿景不被商业机构剽窃并反向收割用户，我坚决禁止任何对本项目核心提示词及索引数据的商业授权。


## 维护说明

由于作者精力有限（个人业余兴趣开发者，非专业背景），目前完全无法对外部代码进行有效的审查和长期维护。因此，本项目暂不支持团队协同开发，不接受 PR。感谢理解。

如果你有好的建议或发现了 Bug，欢迎提交 Issue 进行讨论，我会根据自己的节奏进行改进。如果你希望在本项目基础上进行大规模修改，欢迎 Fork 出属于你自己的版本。