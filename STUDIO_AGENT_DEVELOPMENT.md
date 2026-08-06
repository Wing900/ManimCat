# Studio Agent Development Guide

## 1. 目标

ManimCat Studio Agent 面向两种创作模式：

- `Manim Studio`：生成、检查、渲染和修复 Manim Python。
- `Matplotlib Studio`：生成、检查、渲染和修复 matplotlib Python。

两种模式共享 Agent Runtime，领域知识、代码约束、检查器、渲染器和错误解析器分别由 Studio Mode 提供。

```text
User Request
    ↓
Shared Agent Runtime
    ├── Manim Studio Mode
    └── Matplotlib Studio Mode
    ↓
write/edit → static_check → render → failure_feedback → repair
```

文档知识暂时只保留接入口。后续爬取的 Manim 和 matplotlib 文档分别接入对应 Mode 的 `DocumentationContext`。

## 2. 设计原则

### 2.1 Shared Kernel + Domain Mode

共享 Runtime 负责 Agent 如何运行，Studio Mode 负责 Agent 具体理解什么、检查什么和渲染什么。

核心代码避免散落 `if (studioKind === ...)`。领域差异集中到模式定义和适配器。

```ts
interface StudioModeDefinition {
  kind: 'manim' | 'plot'
  label: string
  documentationKey: 'manim' | 'matplotlib'
  codeLanguage: 'manim-python' | 'python'
  outputModes: readonly ('video' | 'image')[]
  runtimeSummary: string
  autoRenderAfterTools: readonly string[]
}
```

### 2.2 解耦层级与依赖方向

代码按以下层级组织，依赖只能从上层指向下层的稳定接口；领域层禁止反向依赖基础设施。

1. `Domain`：Session、Run、Render、Tool Contract、Message 类型。
2. `Agent Runtime`：Agent Loop、生命周期、取消、步数限制、事件协调。
3. `Orchestration`：Provider 请求、消息组装、Tool Dispatch。
4. `Studio Mode`：Manim / Matplotlib 的 Prompt、文档命名空间、代码语言和能力声明。
5. `Tool Contract`：工具 Schema、允许的 Agent / Studio Kind、结构化结果。
6. `Port`：Render、Documentation、Workspace、Persistence 等稳定接口。
7. `Adapter / Infrastructure`：OpenAI、Bull、Redis、Manim、Python、matplotlib、Supabase、文件系统。

依赖规则：

- `Domain` 不导入 Node.js 文件系统、Bull、Redis、OpenAI、Manim 或 matplotlib。
- `Agent Runtime` 不直接创建 Bull Queue、Python 子进程或数据库客户端。
- `Tool` 依赖 `Port` 和 `ToolContext`，不直接依赖具体 Queue 或执行器。
- `Studio Mode` 描述领域能力，不持有 Supabase、Redis 或前端状态。
- `Adapter` 实现 Port，负责连接具体基础设施。
- `Prompt` 通过可选的 `DocumentationContext` 接收文档，不把爬虫逻辑写进 Agent Loop。
- `Render` 状态由渲染工具和 `RenderStore` 提交，模型只通过工具发起渲染。

当前允许的具体例外：Provider Adapter 可以依赖具体模型 SDK；Render Adapter 可以依赖 Bull、Python 或 Manim。例外必须停留在 Adapter 层。

每次新增代码先回答两个问题：

1. 这段逻辑属于哪个层级？
2. 它是否把下层具体实现泄漏到了上层？

如果一个文件同时处理 Prompt、Tool Schema、数据库写入和 Render 执行，应拆成 Mode、Tool、Runtime、Adapter 四部分。

### 2.3 极简功能边界

当前阶段只建设完成创作闭环所需的能力：

- 文件读取和定位
- 代码写入和局部修改
- 静态检查
- Manim / matplotlib 渲染
- 渲染结果和失败信息反馈
- 有限次自动修复
- 事件流、取消和持久化

暂不建设：

- Session Branch
- 多 Provider
- Skills / Extensions
- Subagent
- Plan Mode
- 插件系统
- 通用 Bash Agent
- 新的数据库和渲染流水线

## 3. 共享 Agent Runtime

共享 Runtime 负责以下稳定能力：

- Session、Run 生命周期
- Agent Loop
- 对话上下文组装
- Tool 调用和结果回传
- Tool 权限检查
- 流式文本、工具和状态事件
- Abort / Cancel
- Run 步数和连续失败限制
- 消息、Part、Run 的持久化

现有代码中的 `StudioSession`、`StudioRun`、`StudioRender`、`StudioMessage` 作为产品领域对象。

Agent Core 不维护额外的任务树。Agent 通过工具读取、编辑、检查和渲染，Runtime 只负责 Run、Message、Part、Render 的生命周期。

## 4. Studio Mode 分工

### 4.1 Manim Studio

- 目标代码：Manim Python
- 主要对象：`Scene`、`Mobject`、`Animation`、`MathTex`
- 输出：视频或静态图片
- 检查：Python、Manim API、场景入口和渲染配置
- 反馈：Manim 日志、异常、渲染阶段和输出路径
- 文档接入口：`DocumentationContext<manim>`

### 4.2 Matplotlib Studio

- 目标代码：matplotlib Python
- 主要对象：`Figure`、`Axes`、Artist、布局和样式
- 输出：PNG 或 SVG 静态图
- 检查：Python、matplotlib API、数据和图表结构
- 反馈：Python 异常、matplotlib 警告、输出路径和图像元数据
- 文档接入口：`DocumentationContext<matplotlib>`

两种 Mode 可以拥有相同的工具名，例如 `render`。工具执行逻辑通过当前 Mode 路由到对应的检查器和渲染器。

## 5. 文档上下文

文档暂时不填充正文，先固定目录和接口，避免后续爬取时改动 Agent Runtime。

建议目录：

```text
docs/
  manim/
  matplotlib/
```

建议抽象：

```ts
interface DocumentationContextProvider {
  getContext(input: {
    kind: 'manim' | 'plot'
    query: string
    maxChars: number
  }): Promise<string>
}
```

当前只定义上下文接入口；文档规模增大后再按任务检索相关片段。文档内容属于上下文来源，不能覆盖 Workspace 和 Render 约束。

## 6. 工具层

工具层只保留生成、检查、渲染、修复闭环所需的工具。

### 6.1 共享只读工具

#### `read`

读取 Workspace 内的文件，返回：

- 相对路径
- 文件内容
- 截断信息
- 文件元数据

#### `ls`

查看 Workspace 目录内容，用于发现项目结构。

#### `glob`

按模式查找文件，例如 `**/*.py`、`**/scene.py`。

#### `grep`

在 Workspace 内搜索符号、API、错误文本和配置。

`ls`、`glob`、`grep` 属于只读工具，可以在同一轮中并行执行。

### 6.2 共享编辑工具

#### `write`

创建或完整覆盖 Workspace 文件。适合首次生成代码。

#### `edit`

基于精确文本替换修改文件。适合小范围修复。

#### `apply_patch`

应用结构化局部补丁。适合多个相邻修改和可审查变更。

编辑工具必须统一经过：

```text
Workspace Root Check
    ↓
File Mutation
```

编辑工具保持串行，避免写入竞争。

### 6.3 领域工具

#### `static_check`

检查当前 Workspace 中的目标 Python 文件。

统一返回：

```ts
interface StaticCheckResult {
  ok: boolean
  issues: Array<{
    file: string
    line?: number
    column?: number
    severity: 'error' | 'warning'
    message: string
  }>
}
```

具体检查规则由 Studio Mode 决定。

#### `render`

执行当前 Studio Mode 的渲染任务。

统一返回：

```ts
interface RenderResult {
  status: 'completed' | 'failed'
  outputMode: 'video' | 'image'
  outputs?: Array<{
    path: string
    mimeType: string
  }>
  error?: string
  details?: string
}
```

Manim Mode 调用 Manim Render Port；Matplotlib Mode 调用 Plot Render Port。两者统一写入 `StudioRender`，由 `RenderStore` 持久化。

### 6.4 交互边界

当前不提供 Question、Review 或人工确认工具。Agent 遇到错误时读取错误结果、修复文件并重新调用工具；Run 通过步数和失败策略限制循环。

## 7. 工具契约

每个工具应具备：

- 参数 Schema
- 工具名称和描述
- Allowed Agent / Studio Kind
- 结构化结果
- `AbortSignal`
- 可展示的标题和元数据

工具层不直接读取 HTTP Request，不直接操作前端状态，不创建数据库或队列客户端；渲染工具只通过 `RenderStore` 和 Render Port 更新渲染记录。

## 8. Agent 工作循环

```text
1. 接收用户任务
2. 读取 Workspace 和相关文档上下文
3. 读取已有代码
4. 生成或修改 Python
5. 执行 static_check
6. 检查通过后执行 render
7. 返回输出或失败信息
8. 失败时有限次修复
9. 达到成功、用户取消或上限后结束
```

Manim 与 Matplotlib 共享循环协议，Mode 决定每一步的工具语义和反馈格式。

## 9. 当前实现优先级

### P0

- 固定 Shared Runtime 与 Studio Mode 的边界
- 收敛 Manim / Plot 的工具注册方式
- 统一 `static_check` 和 `render` 结果
- 保留 Session、Run、Message、Part、Render 持久化与事件流

### P1

- 保持 `DocumentationContextProvider` 接口稳定
- 将 Prompt、检查器、渲染器、失败解析器按 Mode 归组
- 保持有限次自动修复流程
- 减少 Runtime 内部的 `studioKind` 分支

### P2

- 爬取并整理 Manim 文档
- 爬取并整理 matplotlib 文档
- 根据任务加载相关文档片段
- 调整两种 Mode 的领域 Prompt

## 10. 完成标准

Manim Studio 和 Matplotlib Studio 都能完成：

```text
用户描述
  → 生成代码
  → 写入 Workspace
  → Static Check
  → Render
  → 返回产物
```

渲染失败时，Agent 能读取结构化错误，修改代码并在上限内重新检查和渲染。两种 Mode 的差异集中在 Mode 层，Shared Runtime 保持稳定。
