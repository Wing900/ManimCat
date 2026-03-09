---
title: ManimCat
emoji: 🐱
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# ManimCat

English | [简体中文](./README.zh-CN.md)

ManimCat is an AI-powered mathematical animation generator built around Manim, a TypeScript/Node.js web stack, and queue-based rendering. It supports both video output and multi-image output for step-by-step explanations, classroom demos, and math visualization workflows.

## Overview

- Natural-language input to Manim code generation
- Video and image output modes
- AI-assisted retry and code editing flow
- Reference image upload support
- Redis-backed job queue and polling status API
- Prompt management UI for role/system prompt customization
- Server-side upstream routing by `MANIMCAT_ROUTE_*`

## Stack

### Backend

- Express.js (`package.json`: `^4.18.0`, current lock: `4.22.1`)
- TypeScript `5.9.3`
- Bull `4.16.5`
- ioredis `5.9.2`
- OpenAI SDK (`package.json`: `^4.50.0`, current lock: `4.104.0`)
- Zod (`package.json`: `^3.23.0`, current lock: `3.25.76`)

### Frontend

- React (current lock: `19.2.3`)
- TypeScript `5.9.3`
- Vite (`package.json`: `^7.2.4`, current lock: `7.3.1`)
- TailwindCSS `3.4.19`

### Runtime Dependencies

- Python / Manim runtime
- LaTeX (`texlive`)
- `ffmpeg`
- `Xvfb`
- Redis

## Architecture

```text
User Request
  -> POST /api/generate
  -> auth middleware
  -> Bull queue
  -> concept analysis
  -> code generation / retry / edit
  -> Manim render
  -> Redis + filesystem result storage
  -> frontend polling via /api/jobs/:jobId
```

The application itself is not written in Python, but it relies on the Python-based Manim runtime to do the actual rendering.

## Quick Start

### Local

1. Install Node.js 18+, Redis, Python/Manim, LaTeX, `ffmpeg`, and `Xvfb`.
2. Clone the repo and copy `.env.example` to `.env`.
3. Configure at least one AI source.
4. Install dependencies:

```bash
npm install
cd frontend && npm install
cd ..
```

5. Start the app:

```bash
npm run build
npm start
```

Open `http://localhost:3000`.

For full deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md) or the Chinese version [DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md).

## Environment

Common variables:

```env
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=glm-4-flash
CUSTOM_API_URL=https://your-compatible-endpoint/v1
MANIM_TIMEOUT=600000
JOB_TIMEOUT=600000
LOG_LEVEL=info
```

Server-side upstream routing:

```env
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

Priority order for upstream selection:

1. `MANIMCAT_ROUTE_*` matched by Bearer key
2. `customApiConfig` from the request body
3. Server defaults: `OPENAI_API_KEY + CUSTOM_API_URL + OPENAI_MODEL`

## Features

### Video Mode

- Generates a single rendered animation file
- Supports quality, frame rate, and timeout configuration

### Image Mode

- Generates multiple PNG blocks from `YON_IMAGE_n` anchors
- Useful for static slide-like math explanations
- Supports gallery preview and zip download

### Prompt Management

- Role-based prompt editing
- Shared knowledge/rules modules
- Local override persistence in the browser

## Docs

- [README.zh-CN.md](./README.zh-CN.md): Chinese project overview
- [DEPLOYMENT.md](./DEPLOYMENT.md): English deployment guide
- [DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md): Chinese deployment guide

## License and Usage Notice

This repository includes MIT-licensed code and substantial original prompt/data assets by the author.

- Code remains open under the repository license
- Some prompt/index assets are explicitly restricted for commercial use by the author

For the detailed Chinese statement, see [README.zh-CN.md](./README.zh-CN.md).

## Acknowledgements

- [manim-video-generator](https://github.com/rohitg00/manim-video-generator)
- Linux.do community
- Alibaba Cloud Bailian
