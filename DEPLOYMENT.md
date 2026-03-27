# ManimCat Deployment Guide

English | [简体中文](https://github.com/Wing900/ManimCat/blob/main/DEPLOYMENT.zh-CN.md)

This guide only documents deployment paths that match the current repository state.

## How the project actually runs

- Backend: Node.js + Express
- Frontend: built by Vite, then served by the backend
- Queue and job state: Redis
- Rendering runtime: Python + ManimCE + LaTeX + `ffmpeg`
- AI upstreams: preferably configured with `MANIMCAT_ROUTE_*`, or passed per request through `customApiConfig`

## Which path to choose

- Run it on your own machine with the least abstraction: local native deployment
- Keep the runtime closer to production: Docker Compose
- Deploy to Hugging Face: Docker Space

## 1. Local Native Deployment

### Prerequisites

- Node.js 18+
- Redis 7+ reachable at `localhost:6379` by default
- Python 3.11+
- Manim Community Edition 0.19.x
- `mypy`
- LaTeX
- `ffmpeg`

### 1. Clone and configure

```bash
git clone https://github.com/Wing900/ManimCat.git
cd ManimCat
cp .env.example .env
```

Configure at least one routed upstream:

```env
MANIMCAT_ROUTE_KEYS=demo-key
MANIMCAT_ROUTE_API_URLS=https://api.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-example
MANIMCAT_ROUTE_MODELS=gpt-4o-mini
```

Common optional variables:

```env
PORT=3000
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=false
```

### 2. Install dependencies

```bash
npm install
npm --prefix frontend install
python -m pip install mypy
```

### 3. Start

Development:

```bash
npm run dev
```

Production-style run:

```bash
npm run build
npm start
```

Notes:

- `npm run build` currently builds the frontend only.
- `npm start` runs `tsx src/server.ts`, so the backend does not depend on precompiled JS output.

### 4. Verify

- App: `http://localhost:3000`
- Health: `http://localhost:3000/health`

---

## 2. Docker Compose Deployment

This is the most practical default. The repo already includes Redis, the Manim runtime, and the Node runtime in the deployment path.

If you have already published the image, you can also deploy from `wingflow/manimcat` instead of rebuilding locally each time.

### 1. Prepare environment variables

```bash
cp .env.production .env
```

Set at least one upstream profile:

```env
MANIMCAT_ROUTE_KEYS=demo-key
MANIMCAT_ROUTE_API_URLS=https://api.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-example
MANIMCAT_ROUTE_MODELS=gpt-4o-mini
```

If needed, change ports:

```env
PORT=3000
REDIS_PORT=6379
```

### 2. Build and run

```bash
docker compose build
docker compose up -d
```

If you want to use the published image directly, replace the `build` section in `docker-compose.yml` with:

```yaml
image: wingflow/manimcat
```

### 3. Verify

```bash
docker compose ps
```

- App: `http://localhost:3000`
- Health: `http://localhost:3000/health`

Notes:

- Compose exposes port `3000` to the host.
- Inside Compose, Redis is reached through service name `redis`.
- Studio session workspaces are persisted in the `studio-workspace-data` volume at `/app/.studio-workspace`.
- Generated and uploaded images are persisted in the `image-storage` volume at `/app/public/images`.
- Generated videos are persisted in the `video-storage` volume at `/app/public/videos`.
- Manim media cache and intermediate artifacts are persisted in the `manim-media` volume at `/app/media`.
- Temporary render files are persisted in the `manim-tmp` volume at `/app/tmp`.

Inspect volumes if needed:

```bash
docker volume ls
docker volume inspect manimcat_studio-workspace-data
```

---

## 3. Hugging Face Spaces Deployment

### Requirements

- Use a Docker Space.
- The app port is `7860`.
- Environment variables must be defined in Space Settings, not only in a checked-in `.env` file.

### 1. Use the existing root `Dockerfile`

The repository `Dockerfile` is already the Hugging Face compatible one:

- based on `manimcommunity/manim:stable`
- installs Node.js, Redis, CJK fonts, and `ffmpeg`
- starts with `node start-with-redis-hf.cjs`
- defaults to `PORT=7860`

Do not follow older instructions that mention `Dockerfile.huggingface`. That file is not part of the current repo.

If you have already published a Docker image, other environments can reference `wingflow/manimcat`; however, Hugging Face Spaces still builds from the repository `Dockerfile` rather than running a Docker Hub image directly.

### 2. Configure Space Settings

Minimum variables:

```env
PORT=7860
NODE_ENV=production
MANIMCAT_ROUTE_KEYS=demo-key
MANIMCAT_ROUTE_API_URLS=https://api.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-example
MANIMCAT_ROUTE_MODELS=gpt-4o-mini
```

Recommended:

```env
LOG_LEVEL=info
PROD_SUMMARY_LOG_ONLY=true
```

### 3. Push

```bash
git add .
git commit -m "Deploy ManimCat"
git push
```

After deployment:

- App: `https://YOUR_SPACE.hf.space/`
- Health: `https://YOUR_SPACE.hf.space/health`

---

## Upstream Routing

`MANIMCAT_ROUTE_*` is the recommended server-side routing mechanism. It acts as both:

- the Bearer-key whitelist
- the mapping from key to `apiUrl/apiKey/model`

Example:

```env
MANIMCAT_ROUTE_KEYS=user_a,user_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=gpt-4o-mini,gemini-2.5-flash
```

Rules:

1. All four variables support comma-separated or newline-separated values.
2. `MANIMCAT_ROUTE_KEYS` is the primary index.
3. Entries missing `apiUrl` or `apiKey` are skipped.
4. If a variable only provides one value, that value is reused for all entries.
5. If `model` is empty, the key can still authenticate but has no usable model.

Priority:

1. request-body `customApiConfig`
2. server-side `MANIMCAT_ROUTE_*`

Use server-side routing when different users should always hit different upstreams. Use the frontend provider settings when one browser user wants to manage multiple providers locally.

---

## Optional: Supabase Persistence

There are two optional persistence layers:

- generation history: `ENABLE_HISTORY_DB=true`
- Studio Agent session/work persistence: `ENABLE_STUDIO_DB=true`

Shared connection variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-key
```

### Generation history

Apply:

- `src/database/migrations/001_create_history.sql`

If you also want render-failure export, apply:

- `src/database/migrations/002_create_render_failure_events.sql`

Then configure:

```env
ENABLE_HISTORY_DB=true
ENABLE_RENDER_FAILURE_LOG=true
ADMIN_EXPORT_TOKEN=replace_with_long_random_token
```

Export endpoint:

- `GET /api/admin/render-failures/export`
- header: `x-admin-token`

### Studio Agent persistence

Apply:

- `src/database/migrations/003_create_studio_agent.sql`

Then enable:

```env
ENABLE_STUDIO_DB=true
```

---

## Troubleshooting

### The UI loads, but jobs fail immediately

Check:

- `MANIMCAT_ROUTE_*` is fully configured
- the request includes a valid Bearer key
- the matched route entry does not have an empty `model`

### `/health` shows unhealthy Redis or queue

Check:

- Redis is actually running
- `REDIS_HOST` and `REDIS_PORT` match your environment
- in Docker Compose, the backend is pointing to service `redis`

### The container starts locally, but Hugging Face build fails

Check:

- the Space SDK is Docker
- env vars were added in Space Settings
- you did not follow stale instructions mentioning `Dockerfile.huggingface`
