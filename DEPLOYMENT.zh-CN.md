# ManimCat 部署文档

简体中文 | [English](https://github.com/Wing900/ManimCat/blob/main/DEPLOYMENT.md)

这份文档只保留当前项目实际可用的部署路径，并尽量压缩为最短步骤。

## 先确认项目怎么运行

- 后端是 Node.js + Express。
- 前端由 Vite 构建，产物由后端静态托管。
- 任务队列和状态依赖 Redis。
- 实际渲染依赖 Python、ManimCE、LaTeX、`ffmpeg`。
- 上游 AI 不再依赖 `OPENAI_API_KEY` 这类单一全局变量，推荐使用 `MANIMCAT_ROUTE_*`，或由前端按请求传 `customApiConfig`。

## 选择哪种部署方式

- 只想本机跑起来：用“本地原生部署”。
- 想减少环境差异：用“Docker Compose”。
- 想部署到 Hugging Face Space：用“Hugging Face Spaces”。

## 一、本地原生部署

### 前置条件

- Node.js 18+
- Redis 7+，默认可通过 `localhost:6379` 访问
- Python 3.11+
- Manim Community Edition 0.19.x
- `mypy`
- LaTeX
- `ffmpeg`

### 1. 拉代码并准备环境变量

```bash
git clone https://github.com/Wing900/ManimCat.git
cd ManimCat
cp .env.example .env
```

至少配置一组服务端上游路由：

```env
MANIMCAT_ROUTE_KEYS=demo-key
MANIMCAT_ROUTE_API_URLS=https://api.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-example
MANIMCAT_ROUTE_MODELS=gpt-4o-mini
```

常用可选项：

```env
PORT=3000
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=false
```

### 2. 安装依赖

```bash
npm install
npm --prefix frontend install
python -m pip install mypy
```

### 3. 启动

开发模式：

```bash
npm run dev
```

生产式启动：

```bash
npm run build
npm start
```

说明：

- `npm run build` 当前只构建前端。
- `npm start` 直接用 `tsx src/server.ts` 启动后端，不依赖预编译 JS。

### 4. 验证

- 页面：`http://localhost:3000`
- 健康检查：`http://localhost:3000/health`

---

## 二、Docker Compose 部署

这是最推荐的部署方式，仓库已经内置 Redis、Manim 运行时和 Node 运行时。

如果你已经将镜像推到了 Docker Hub，也可以直接使用 `wingflow/manimcat`，不必每次都本地 `build`。

### 1. 准备环境变量

```bash
cp .env.production .env
```

至少填写一组上游：

```env
MANIMCAT_ROUTE_KEYS=demo-key
MANIMCAT_ROUTE_API_URLS=https://api.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-example
MANIMCAT_ROUTE_MODELS=gpt-4o-mini
```

如需改端口：

```env
PORT=3000
REDIS_PORT=6379
```

### 2. 构建并启动

```bash
docker compose build
docker compose up -d
```

如果改为直接使用已发布镜像，请把 `docker-compose.yml` 里的 `build` 段替换为：

```yaml
image: wingflow/manimcat
```

### 3. 验证

```bash
docker compose ps
```

- 页面：`http://localhost:3000`
- 健康检查：`http://localhost:3000/health`

说明：

- Compose 对外暴露 `3000`。
- 容器内 Redis 服务名固定为 `redis`。
- Studio 会话工作目录会持久化到 `studio-workspace-data` volume，挂载到 `/app/.studio-workspace`。
- 生成图片与上传的参考图会持久化到 `image-storage` volume，挂载到 `/app/public/images`。
- 生成的视频会持久化到 `video-storage` volume，挂载到 `/app/public/videos`。
- Manim 的媒体缓存与中间渲染文件会持久化到 `manim-media` volume，挂载到 `/app/media`。
- 临时渲染目录会持久化到 `manim-tmp` volume，挂载到 `/app/tmp`。

如需检查 volume：

```bash
docker volume ls
docker volume inspect manimcat_studio-workspace-data
```

---

## 三、Hugging Face Spaces 部署

### 前提

- Space 类型必须选 Docker。
- 运行端口使用 `7860`。
- 环境变量必须配置在 Space Settings，不是只写进仓库 `.env`。

### 1. 直接使用仓库根目录的 `Dockerfile`

当前仓库里的 `Dockerfile` 已经是 Hugging Face Space 可用版本：

- 基于 `manimcommunity/manim:stable`
- 容器内安装 Node.js、Redis、中文字体、`ffmpeg`
- 启动命令是 `node start-with-redis-hf.cjs`
- 默认监听 `PORT=7860`

不需要再额外复制一个 `Dockerfile.huggingface`，仓库里也没有这个文件。

如果你已经发布了 Docker 镜像，也可以让其他部署环境直接参考 `wingflow/manimcat` 的内容；但 Hugging Face Space 仍然是基于仓库内 `Dockerfile` 构建，不是直接拉 Docker Hub 镜像运行。

### 2. 在 Space Settings 配置变量

至少配置：

```env
PORT=7860
NODE_ENV=production
MANIMCAT_ROUTE_KEYS=demo-key
MANIMCAT_ROUTE_API_URLS=https://api.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-example
MANIMCAT_ROUTE_MODELS=gpt-4o-mini
```

建议再补上：

```env
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
```

### 3. 推送代码

```bash
git add .
git commit -m "Deploy ManimCat"
git push
```

部署完成后访问：

- 页面：`https://YOUR_SPACE.hf.space/`
- 健康检查：`https://YOUR_SPACE.hf.space/health`

---

## 上游路由配置

推荐使用 `MANIMCAT_ROUTE_*` 做服务端路由。它同时承担两件事：

- Bearer key 白名单
- key 到上游 `apiUrl/apiKey/model` 的映射

示例：

```env
MANIMCAT_ROUTE_KEYS=user_a,user_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=gpt-4o-mini,gemini-2.5-flash
```

规则：

1. 四组变量都支持逗号或换行分隔。
2. `MANIMCAT_ROUTE_KEYS` 是主索引。
3. `apiUrl` 或 `apiKey` 缺失的条目会被跳过。
4. 如果某一组变量只写了一个值，这个值会复用到全部条目。
5. `model` 留空时，该 key 仍可认证，但当前没有可用模型。

请求优先级：

1. 请求体里的 `customApiConfig`
2. 服务端 `MANIMCAT_ROUTE_*`

如果要给不同用户固定分配不同上游，用服务端路由；如果只是单个浏览器本地切换多个 provider，用前端设置页即可。

---

## 可选：Supabase 持久化

项目有两类可选持久化：

- 生成历史：`ENABLE_HISTORY_DB=true`
- Studio Agent 会话与工作流：`ENABLE_STUDIO_DB=true`

公共连接配置：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-key
```

### 生成历史

先执行迁移：

- `src/database/migrations/001_create_history.sql`

如需渲染失败事件导出，再执行：

- `src/database/migrations/002_create_render_failure_events.sql`

对应变量：

```env
ENABLE_HISTORY_DB=true
ENABLE_RENDER_FAILURE_LOG=true
ADMIN_EXPORT_TOKEN=replace_with_long_random_token
```

导出接口：

- `GET /api/admin/render-failures/export`
- 请求头：`x-admin-token`

### Studio Agent 持久化

先执行迁移：

- `src/database/migrations/003_create_studio_agent.sql`

再开启：

```env
ENABLE_STUDIO_DB=true
```

---

## 排查清单

### 页面能开，但提交任务失败

优先检查：

- `MANIMCAT_ROUTE_*` 是否完整配置
- 请求头里是否带了合法 Bearer key
- 当前 key 对应的 `model` 是否为空

### `/health` 里 `redis` 或 `queue` 不健康

优先检查：

- Redis 是否真的启动
- `REDIS_HOST` / `REDIS_PORT` 是否匹配
- Docker 部署时后端是否连到了容器内 `redis`

### 容器能起，但 Space 一直构建失败

优先检查：

- Space SDK 是否选了 Docker
- 是否把环境变量写到了 Space Settings
- 是否错误照搬了旧文档里的 `Dockerfile.huggingface`
