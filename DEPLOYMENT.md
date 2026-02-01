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
```

4. 推送并等待构建

```bash
git add .
git commit -m "Deploy ManimCat"
git push
```

部署完成后访问：`https://YOUR_SPACE.hf.space/`
