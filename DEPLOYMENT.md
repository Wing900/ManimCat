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

前端设置页的这四个输入框支持“单值”或“多值（逗号/换行分隔）”：

- `API 地址`
- `API 密钥`
- `模型名称`
- `ManimCat API 密钥`

系统会按顺序配对并轮询使用（round-robin）：

1. `url[0] + key[0] + model[0] + manimcatKey[0]`
2. `url[1] + key[1] + model[1] + manimcatKey[1]`
3. ...

规则说明：

- `API 地址` 和 `API 密钥` 必填才能组成有效配置项。
- `模型名称`、`ManimCat API 密钥`可缺省；缺省时会回退到同组可用值或默认行为。
- 每次发起任务会自动选择下一组配置，提交/轮询/取消使用同一组 `ManimCat` key。

示例（可直接粘贴到设置页）：

```text
API 地址:
https://api-a.example.com/v1
https://api-b.example.com/v1

API 密钥:
sk-a
sk-b

模型名称:
model-a
model-b

ManimCat API 密钥:
mc-a
mc-b
```
