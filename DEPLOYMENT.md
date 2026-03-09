# ManimCat Deployment Guide

English | [简体中文](./DEPLOYMENT.zh-CN.md)

This document covers three deployment paths:

- local native deployment
- local Docker deployment
- Hugging Face Spaces deployment with Docker

## 1. Local Native Deployment

### Prerequisites

1. Node.js 18+
2. Redis running on `localhost:6379` or equivalent
3. Python / Manim runtime
4. LaTeX (`texlive`)
5. `ffmpeg`
6. `Xvfb`

### Setup

```bash
git clone https://github.com/yourusername/ManimCat.git
cd ManimCat
cp .env.example .env
```

Configure at least one AI source:

```env
OPENAI_API_KEY=your-openai-api-key
```

Or configure server-side upstream routing:

```env
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

Optional:

```env
OPENAI_MODEL=glm-4-flash
CUSTOM_API_URL=https://your-proxy-api/v1
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=false
OPENAI_STREAM_INCLUDE_USAGE=false
```

Install dependencies:

```bash
npm install
cd frontend && npm install
cd ..
```

Build and start:

```bash
npm run build
npm start
```

Open: `http://localhost:3000`

---

## 2. Local Docker Deployment

### Prerequisites

1. Docker 20.10+
2. Docker Compose 2.0+

### Setup

```bash
cp .env.production .env
```

Set at least one AI source:

```env
OPENAI_API_KEY=your-openai-api-key
```

Or use key-based upstream routing:

```env
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

Recommended production settings:

```env
NODE_ENV=production
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
OPENAI_STREAM_INCLUDE_USAGE=true
```

Build and run:

```bash
docker-compose build
docker-compose up -d
```

Open: `http://localhost:3000`

---

## 3. Hugging Face Spaces Deployment

### Notes

- Use a Docker Space
- Default port is `7860`
- Environment variables must be configured in Space Settings, not only in repo files
- Seeing `injecting env (0) from .env` in startup logs is normal and does not mean Space variables failed

### Steps

1. Clone your Space repository:

```bash
git clone https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE_NAME
cd YOUR_SPACE_NAME
```

2. Copy the project into the Space repo and use the Hugging Face Dockerfile when applicable.

3. In Space Settings, configure at least:

```env
PORT=7860
NODE_ENV=production
```

And one AI source:

```env
OPENAI_API_KEY=your-openai-api-key
```

Or:

```env
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

Recommended production logging:

```env
NODE_ENV=production
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
```

4. Commit and push:

```bash
git add .
git commit -m "Deploy ManimCat"
git push
```

Open: `https://YOUR_SPACE.hf.space/`

---

## 4. Key-Based Upstream Routing

When you want different users to always hit different upstream providers, configure:

```env
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

Rules:

1. All four variables support comma-separated or newline-separated values.
2. `MANIMCAT_ROUTE_KEYS` is the primary index.
3. Entries without `apiUrl` or `apiKey` are skipped.
4. Empty `model` falls back to `OPENAI_MODEL`.
5. `MANIMCAT_ROUTE_KEYS` also acts as the auth whitelist.

Priority:

1. `MANIMCAT_ROUTE_*`
2. request body `customApiConfig`
3. server defaults

---

## 5. Frontend Multi-Profile Custom API

The frontend settings page still supports multiple `url/key/model/manimcatKey` profiles with round-robin selection per browser session.

Use that when a single user wants to manage multiple upstreams locally.

If you want stable upstream routing per user, prefer server-side `MANIMCAT_ROUTE_*`.
