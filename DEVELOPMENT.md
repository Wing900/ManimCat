# ManimCat 开发规范

这份文档用于日常开发。Studio Agent 的详细架构见 `STUDIO_AGENT_DEVELOPMENT.md`。

## 1. 代码风格

- 使用 TypeScript / TSX。
- 使用单引号、无分号、2 空格缩进、尾随逗号。
- React 组件使用 `PascalCase`。
- Hook 使用 `useXxx` 命名。
- 函数和变量使用 `camelCase`。
- 类型和接口使用 `PascalCase`。
- 新代码禁止引入裸 `any`，外部数据先使用 `unknown` 并完成校验。
- 公共函数、Service 和 API 返回值写明类型。
- 注释解释设计原因，避免重复代码含义。

## 2. 代码边界

```text
页面 → Hook / Store → API / Service → Domain → Port → Adapter
```

- 页面负责展示和用户事件。
- Hook / Store 负责前端状态。
- Service / Runtime 负责业务流程。
- Domain 保持纯净，不直接依赖数据库、队列、文件系统和第三方 SDK。
- Tool 只通过 Tool Contract 和 Port 访问外部能力。
- Adapter 负责连接 OpenAI、Bull、Redis、Python、Manim、matplotlib 和 Supabase。
- 新增代码先确认所属层级，避免跨层直接调用。

## 3. 修改原则

- 一个提交只解决一个主要问题。
- Bug 修复需要增加对应回归测试。
- 重构保持功能行为稳定。
- 修改 API 时同步更新请求类型、响应类型和调用方。
- 避免顺手加入未计划的功能和大范围格式化。
- 删除或替换模块前先搜索全部调用方。

## 4. 提交信息

使用 Conventional Commits：

```text
feat: 新增功能
fix: 修复问题
refactor: 重构代码
test: 增加或修改测试
docs: 修改文档
chore: 工程维护
```

示例：

```text
fix(studio): preserve session snapshot after render
refactor(agent): narrow runtime facade
```

## 5. CI 检查

Pull Request 至少执行：

```text
Backend TypeScript 编译
Frontend TypeScript 检查
全量测试
Frontend / Backend 构建
```

`Frontend ESLint` 当前属于遗留基线治理项。新增代码应保持无新增错误和警告；待现有问题按独立单元清理后，再加入 CI 必检。

本地提交前执行：

```powershell
npm run build:backend
cd frontend
npx tsc -p tsconfig.app.json --noEmit
cd ..
npm test
npm run build
```

需要检查前端静态规则时，单独执行：

```powershell
cd frontend
npm run lint
cd ..
```

CI 检查通过后才允许合并到主分支。Docker 发布只在检查通过后执行。
