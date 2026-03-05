# ManimCat 部署文档

本文档包含三种部署方式：本地部署、本地 Docker 部署、Hugging Face Spaces（Docker）。

三种部署都是可行的，hf的部署使用免费的服务器已经足够。

## 本地部署

### 阶段 1: 准备 Node 环境

1. 安装 Node.js >= 18
2. 安装 Redis 7 并保持 `localhost:6379` 可用
3. 安装 Python 3.11、Manim Community Edition 0.19.2、LaTeX (texlive)、ffmpeg、Xvfb

### 阶段 2: 拉取代码并配置环境变量

```bash
git clone https://github.com/yourusername/ManimCat.git
cd ManimCat
cp .env.example .env
```

在 `.env` 中至少设置一类 AI 来源：

```env
OPENAI_API_KEY=your-openai-api-key
```

或使用按 key 分流（无需默认后端 key）：

```env
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

可选：

```env
OPENAI_MODEL=glm-4-flash
CUSTOM_API_URL=https://your-proxy-api/v1
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=false
OPENAI_STREAM_INCLUDE_USAGE=false
```

### 阶段 3: 安装依赖

```bash
npm install
cd frontend && npm install
cd ..
```

### 阶段 4: 构建并启动

```bash
npm run build
npm start
```

访问：`http://localhost:3000`

---

## 本地 Docker 部署

### 阶段 1: 准备 Docker 环境

1. 安装 Docker 20.10+ 与 Docker Compose 2.0+

### 阶段 2: 配置环境变量

```bash
cp .env.production .env
```

在 `.env` 中至少设置一类 AI 来源：

```env
OPENAI_API_KEY=your-openai-api-key
```

或使用按 key 分流（无需默认后端 key）：

```env
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

生产推荐额外设置：

```env
NODE_ENV=production
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
# 如果你的上游模型/网关支持 stream_options.include_usage，可以开启
OPENAI_STREAM_INCLUDE_USAGE=true

# 按 key 路由到不同上游
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

### 阶段 3: 构建并启动

```bash
docker-compose build
docker-compose up -d
```

### 阶段 4: 验证服务

访问：`http://localhost:3000`

---

## Hugging Face 部署（Docker）

### 前置说明

- 需要 Docker Space（SDK 选择 Docker）
- 推荐 CPU upgrade（4 vCPU / 32GB）
- 默认端口为 7860
- Hugging Face 运行时环境变量来自 **Space Settings -> Variables/Secrets**，不是仓库里的 `.env`
- 启动日志出现 `injecting env (0) from .env` 属于正常现象，不代表 Settings 变量未生效

### 步骤

1. 准备 Space 仓库

```bash
git clone https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE_NAME
cd YOUR_SPACE_NAME
```

2. 复制项目文件

```bash
cp -r /path/to/ManimCat/* .
cp Dockerfile.huggingface Dockerfile
```

3. 在 Space Settings 中配置变量（必须在 Settings 中设置）

至少设置：

```env
PORT=7860
NODE_ENV=production
```

并配置一类 AI 来源（任选其一）：

```env
# 方式 A：默认后端 AI
OPENAI_API_KEY=your-openai-api-key

# 方式 B：按 key 分流（可不填 OPENAI_API_KEY）
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

可选：

```env
OPENAI_MODEL=glm-4-flash
CUSTOM_API_URL=https://your-proxy-api/v1
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
OPENAI_STREAM_INCLUDE_USAGE=true
```

如果你希望生产环境只保留每任务一条摘要日志，请确保以下三项都已在 Settings 配置并重启 Space：

```env
NODE_ENV=production
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
```

4. 推送并等待构建

```bash
git add .
git commit -m "Deploy ManimCat"
git push
```

部署完成后访问：`https://YOUR_SPACE.hf.space/`

---

## 按 ManimCat Key 分流（推荐）

### 目标

当你需要区分“测试用户 / 正式用户”时，推荐在服务端用 `MANIMCAT_ROUTE_*` 做固定路由：

- `user_key_a` 走上游 A（例如 `https://api-a.example.com/v1 + qwen3.5-plus + sk-a`）
- `user_key_b` 走上游 B（例如 `https://api-b.example.com/v1 + gemini-3-flash-preview + sk-b`）

### 配置方式

```env
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

规则：

1. 以上四组变量都支持逗号或换行分隔。
2. 以 `MANIMCAT_ROUTE_KEYS` 为主索引逐项配对。
3. `apiUrl` 或 `apiKey` 缺失的条目会被跳过。
4. `model` 可留空，留空时回退到 `OPENAI_MODEL`。
5. `MANIMCAT_ROUTE_KEYS` 本身就是认证白名单。

### 上游选择优先级（高 -> 低）

1. 命中 `MANIMCAT_ROUTE_*`（按 Bearer key 映射）
2. 请求体 `customApiConfig`（前端自定义 API）
3. 后端默认 `OPENAI_API_KEY + CUSTOM_API_URL + OPENAI_MODEL`

## 前端多组 Custom API（可选）

前端设置页仍支持多组 `url/key/model/manimcatKey` 轮询；它适合“同一浏览器用户自管多组上游”。  
如果你希望“不同用户固定走不同上游”，优先使用上面的服务端 `MANIMCAT_ROUTE_*`。
