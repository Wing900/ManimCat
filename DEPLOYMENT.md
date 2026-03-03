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

在 `.env` 中至少设置：

```env
OPENAI_API_KEY=your-openai-api-key
```

可选：

```env
OPENAI_MODEL=glm-4-flash
CUSTOM_API_URL=https://your-proxy-api/v1
MANIMCAT_API_KEY=your-api-key
MANIMCAT_API_KEYS=your-api-key-2,your-api-key-3
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

在 `.env` 中至少设置：

```env
OPENAI_API_KEY=your-openai-api-key
```

生产推荐额外设置：

```env
NODE_ENV=production
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
# 如果你的上游模型/网关支持 stream_options.include_usage，可以开启
OPENAI_STREAM_INCLUDE_USAGE=true

# 至少配置一个 key
MANIMCAT_API_KEY=your-api-key-1
# 可选：配置多个 key（逗号或换行分隔）
MANIMCAT_API_KEYS=your-api-key-2,your-api-key-3
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

3. 在 Space Settings 中配置变量

至少设置：

```env
OPENAI_API_KEY=your-openai-api-key
PORT=7860
NODE_ENV=production
```

可选：

```env
OPENAI_MODEL=glm-4-flash
CUSTOM_API_URL=https://your-proxy-api/v1
MANIMCAT_API_KEY=your-api-key
MANIMCAT_API_KEYS=your-api-key-2,your-api-key-3
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
OPENAI_STREAM_INCLUDE_USAGE=true
```

4. 推送并等待构建

```bash
git add .
git commit -m "Deploy ManimCat"
git push
```

部署完成后访问：`https://YOUR_SPACE.hf.space/`

---

## 前端多组 Custom API 分流

### 整体架构

ManimCat 的 AI 调用有两种来源：

1. **后端默认 client**：由服务器的 `OPENAI_API_KEY` + `CUSTOM_API_URL` + `OPENAI_MODEL` 创建，服务器出钱。
2. **前端 Custom API**：用户在前端设置页自行填写 API 地址/密钥/模型，用户出钱。

当前端填写了 Custom API 配置时，请求会携带 `customApiConfig` 发送到后端，后端使用用户提供的 key 调用 AI；
如果前端没有填写，后端会使用服务器自己的默认 client。

### 多 Profile 配置

前端设置页的四个输入框都支持**逗号或换行分隔**填写多个值：

| 字段 | 是否必填 | 说明 |
|------|---------|------|
| API 地址 | 必填 | 缺少则该组配置**跳过** |
| API 密钥 | 必填 | 缺少则该组配置**跳过** |
| 模型名称 | 可选 | 留空时后端回退到服务器的 `OPENAI_MODEL` |
| ManimCat API 密钥 | 可选 | 用于后端认证（如果开启了 `MANIMCAT_API_KEY`） |

系统按索引位置一一配对，生成多个 Profile，每次请求自动轮换（round-robin）：

```
Profile 0 = url[0] + key[0] + model[0] + manimcatKey[0]
Profile 1 = url[1] + key[1] + model[1] + manimcatKey[1]
...
```

### 值的对齐规则

| 情况 | 行为 |
|------|------|
| 只写了 **1 个值** | 所有 Profile 复用这个值 |
| 写了 **N 个值** | 严格按索引对应 |
| 某个索引位置 **超出范围** | 该字段为空字符串 |

例如 URL 只写 1 个、Key 写 2 个 → 两个 Profile 都复用同一个 URL。

### 示例

#### 场景 1：两个不同的 API 提供商轮换

```text
API 地址:      https://api-a.example.com/v1, https://api-b.example.com/v1
API 密钥:      sk-a, sk-b
模型名称:      qwen-plus, glm-4-flash
ManimCat 密钥: mc-a, mc-b
```

结果：Profile 0 用 api-a + qwen-plus，Profile 1 用 api-b + glm-4-flash，交替使用。

#### 场景 2：同一个 URL、两个 Key 分散限流

```text
API 地址:      https://api.example.com/v1
API 密钥:      sk-main, sk-backup
模型名称:      qwen-plus
ManimCat 密钥: mc-key
```

结果：两个 Profile 共享同一个 URL、同一个模型、同一个认证 key，只是 API 密钥不同。适合同一提供商有多个 key 时分散请求压力。

#### 场景 3：一个 Key 用指定模型，另一个 Key 用服务器默认模型

```text
API 地址:      https://api.example.com/v1
API 密钥:      sk-premium, sk-free
模型名称:      qwen-plus,
ManimCat 密钥: mc-a, mc-b
```

注意模型名称 `qwen-plus,`（末尾有逗号）→ 拆分后得到 `[“qwen-plus”]`，只有 1 个值。
按”只写了 1 个值”的规则，两个 Profile 都会使用 `qwen-plus`。

如果你希望第二个 Profile 使用不同的模型，需要显式写两个值：

```text
模型名称:      qwen-plus, glm-4-flash
```

> **注意**：模型名称留空时，后端会回退到服务器环境变量 `OPENAI_MODEL` 的值（默认 `glm-4-flash`）。
> 目前没有”禁止某个 Key 使用 AI”的机制——只要请求通过认证，就可以调用 AI。
