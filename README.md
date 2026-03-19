---
title: ManimCat
emoji: 🐱
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

English | [简体中文](https://github.com/Wing900/ManimCat/blob/main/README.zh-CN.md)

<div align="center">

<!-- Top decorative wave -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=455A64&height=120&section=header" />

<br>

<img src="public/logo.svg" width="200" alt="ManimCat Logo" />

<!-- Cat paw accent -->
<div style="opacity: 0.3; margin: 20px 0;">
  <img src="https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Animals/Paw%20Prints.png" width="40" alt="paws" />
</div>

<h1>
  <picture>
    <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=40&duration=3000&pause=1000&color=455A64&center=true&vCenter=true&width=435&lines=ManimCat+%F0%9F%90%BE" alt="ManimCat" />
  </picture>
</h1>

<!-- Math symbol divider -->
<p align="center">
  <span style="font-family: monospace; font-size: 24px; color: #90A4AE;">
    ∫ &nbsp; ∑ &nbsp; ∂ &nbsp; ∞
  </span>
</p>

<p align="center">
  <strong>🎬 AI-Powered Mathematical Animation Generator</strong>
</p>

<p align="center">
  Making mathematical animation creation simple and elegant, powered by Manim and large language models
</p>

<!-- Geometric divider -->
<div style="margin: 30px 0;">
  <span style="color: #CFD8DC; font-size: 20px;">◆ &nbsp; ◆ &nbsp; ◆</span>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/ManimCE-0.19.2-455A64?style=for-the-badge&logo=python&logoColor=white" alt="ManimCE" />
  <img src="https://img.shields.io/badge/React-19.2.0-455A64?style=for-the-badge&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-18+-455A64?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-Mixed-607D8B?style=for-the-badge" alt="License" />
</p>

<p align="center" style="font-size: 18px;">
  <a href="#preface"><strong>Preface</strong></a> •
  <a href="#examples"><strong>Examples</strong></a> •
  <a href="#technology"><strong>Technology</strong></a> •
  <a href="#deployment"><strong>Deployment</strong></a> •
  <a href="#contributions"><strong>Contributions</strong></a> •
  <a href="#license-and-copyright"><strong>License</strong></a> •
  <a href="#maintenance-notes"><strong>Maintenance</strong></a>
</p>

<br>

<!-- Bottom decorative wave -->
<img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=455A64&height=100&section=footer" />

</div>

<br>

## Preface

I am happy to introduce my new project, ManimCat. It is, after all, a cat.

This project is a substantial architectural reconstruction and extended rework based on [manim-video-generator](https://github.com/rohitg00/manim-video-generator). My thanks go to the original author, Rohit Ghumare. I rewrote the frontend and backend architecture, addressed the original bottlenecks around concurrency and rendering stability, and pushed the product further in the direction of my own design and usability goals.

ManimCat is an AI-powered math visualization platform that supports both `video` and `image` output modes, aimed at classroom teaching and problem explanation scenarios.

Users only need to describe what they want in natural language. The system then uses AI to generate Manim code automatically and renders it as either an animation video or a sequence of static images, depending on the chosen mode. It supports LaTeX formulas, two-stage generation, retry-based error repair, and anchor-based segmented rendering in image mode, making it especially suitable for teaching content built around step-by-step derivation and visual reasoning.

### Interface

![image-20260221125910244](https://raw.githubusercontent.com/Wing900/ManimCat/main/public/readme-images/ui-1.png)

![image-20260221130027231](https://raw.githubusercontent.com/Wing900/ManimCat/main/public/readme-images/ui-2.png)

![image-20260221130809525](https://raw.githubusercontent.com/Wing900/ManimCat/main/public/readme-images/ui-3.png)

## Examples

<div align="center">

> *Prove that $1/4 + 1/16 + 1/64 + \dots = 1/3$ using a beautiful geometric method, elegant zooming, smooth camera movement, a slow pace, at least two minutes of duration, clear logic, a creamy yellow background, and a macaroon-inspired palette.*

<br>

<a href="https://github.com/user-attachments/assets/38dba3ba-e29f-458d-b8ea-baf10cade4f1">
  <video src="https://github.com/user-attachments/assets/38dba3ba-e29f-458d-b8ea-baf10cade4f1" width="85%" autoplay loop muted playsinline>
  </video>
</a>

<sub>▲ Generated with BGM · Geometric Series Proof · ManimCat</sub>

</div>


## Technology

### Tech Stack

**Backend**
- Express.js (`package.json`: `^4.18.0`, current `package-lock.json`: `4.22.1`) + TypeScript `5.9.3`
- Bull `4.16.5` + ioredis `5.9.2` for the Redis-backed job queue
- OpenAI SDK (`package.json`: `^4.50.0`, current `package-lock.json`: `4.104.0`)
- Zod (`package.json`: `^3.23.0`, current `package-lock.json`: `3.25.76`) for data validation
- Supabase JS (`@supabase/supabase-js`) for optional persistent history storage

**Frontend**
- React (current lock version `19.2.3`) + TypeScript `5.9.3`
- Vite (`package.json`: `^7.2.4`, current lock version `7.3.1`)
- TailwindCSS `3.4.19`
- react-syntax-highlighter `16.1.0`

**System Dependencies**
- Python / Manim runtime (Docker base image: `manimcommunity/manim:stable`)
- LaTeX (`texlive`)
- `ffmpeg` + `Xvfb`

**Deployment**
- Docker + Docker Compose
- Redis (installed inside the container as `redis-server`; no separate major version is locked in this repository)

### Technical Approach

```text
User request -> POST /api/generate (outputMode: video | image)
                |
                v
         [Auth middleware]
                |
                v
         [Bull job queue]
                |
                v
    +-----------------------------------------------+
    |               Generation pipeline             |
    |-----------------------------------------------|
    | 1. Concept analysis                           |
    |    - Always routed through AI                 |
    | 2. Two-stage generation                       |
    |    - Stage 1: Concept Designer               |
    |    - Stage 2: Code Generator                 |
    | 3. Code retry manager (up to 4 retries)      |
    | 4. Rendering by output mode                   |
    |    - video: render mp4                        |
    |    - image: parse YON_IMAGE anchors and      |
    |             render PNGs one by one            |
    | 5. Store outputs and timing data             |
    |    - Redis + filesystem                       |
    +-----------------------------------------------+
                |
                v
        Frontend polling for status
                |
                v
     GET /api/jobs/:jobId (video_url | image_urls)
```

**Retry mechanism**
- The concept designer's result is preserved, so the design step does not need to run again.
- Every retry sends the full conversation history, including the original prompt, previous code, and error messages.
- The system retries up to 4 times before marking the job as failed.

**Image mode**
- Output must be organized as `YON_IMAGE_n` anchor code blocks. The backend counts the anchor groups and renders each image separately.
- If any image fails to render, the entire job fails under strict mode.
- The returned field is `image_urls` for image mode and `video_url` for video mode.

### Environment Variables

| Environment Variable | Default | Description |
|---------|--------|------|
| `PORT` | `3000` | Server port |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | - | Redis password, if needed |
| `REDIS_DB` | `0` | Redis database |
| `MANIMCAT_ROUTE_KEYS` | - | List of ManimCat keys for upstream mapping, separated by commas or new lines |
| `MANIMCAT_ROUTE_API_URLS` | - | Upstream API URLs matched to `MANIMCAT_ROUTE_KEYS` by index |
| `MANIMCAT_ROUTE_API_KEYS` | - | Upstream API keys matched to `MANIMCAT_ROUTE_KEYS` by index |
| `MANIMCAT_ROUTE_MODELS` | - | Upstream models matched to `MANIMCAT_ROUTE_KEYS` by index. Leave empty to disable a key (no model available) |
| `AI_TEMPERATURE` | `0.7` | Generation temperature |
| `AI_MAX_TOKENS` | `12000` | Maximum output tokens |
| `AI_THINKING_TOKENS` | `20000` | Maximum thinking (chain-of-thought) tokens |
| `DESIGNER_TEMPERATURE` | `0.8` | Designer temperature |
| `DESIGNER_MAX_TOKENS` | `12000` | Maximum designer output tokens |
| `DESIGNER_THINKING_TOKENS` | `20000` | Maximum designer thinking tokens |
| `REQUEST_TIMEOUT` | `600000` | Request timeout in milliseconds |
| `JOB_TIMEOUT` | `600000` | Job timeout in milliseconds |
| `MANIM_TIMEOUT` | `600000` | Manim render timeout in milliseconds |
| `LOG_LEVEL` | `info` | Log level (`debug/info/warn/error`) |
| `PROD_SUMMARY_LOG_ONLY` | `true` | In production, only emit one summary log line per job |
| `CODE_RETRY_MAX_RETRIES` | `4` | Number of code-fix retries |
| `MEDIA_RETENTION_HOURS` | `72` | Retention period for image and video files |
| `MEDIA_CLEANUP_INTERVAL_MINUTES` | `60` | Media cleanup interval in minutes |
| `JOB_RESULT_RETENTION_HOURS` | `24` | Retention period for job results and stage data |
| `USAGE_RETENTION_DAYS` | `90` | Retention period for daily aggregated usage metrics |
| `METRICS_USAGE_RATE_LIMIT_MAX` | `30` | Maximum number of usage requests per IP in each rate limit window |
| `METRICS_USAGE_RATE_LIMIT_WINDOW_MS` | `60000` | Usage API rate limit window in milliseconds |
| `ENABLE_HISTORY_DB` | `false` | Enable persistent generation history (requires Supabase) |
| `SUPABASE_URL` | - | Supabase project URL |
| `SUPABASE_KEY` | - | Supabase anon key or service role key |

**Example `.env`**

```bash
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
AI_TEMPERATURE=0.7
CODE_RETRY_MAX_RETRIES=4
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

**Upstream selection priority, from high to low**

1. request body `customApiConfig` (when enabled on the frontend)
2. `MANIMCAT_ROUTE_*` matching the current Bearer key

## Deployment

Please see the [deployment guide](https://github.com/Wing900/ManimCat/blob/main/DEPLOYMENT.md).

## Contributions

I made fairly extensive modifications and refactors to the original project so it would better reflect my own design goals:

1. Architectural refactor
- The backend now uses an Express.js + Bull job queue architecture

2. Frontend/backend separation
- The frontend is fully separated, built with React + TypeScript + Vite

3. Storage overhaul
- Redis stores job status and results with TTL management, and the old concept-cache shortcut is no longer used

4. Queue system
- Bull + Redis job queues with retries, timeouts, and exponential backoff

5. Frontend stack
- React 19 + TailwindCSS + react-syntax-highlighter

6. Project structure
- `src/{config,database,middlewares,routes,services,queues,prompts,types,utils}/`
- `frontend/src/{components,hooks,lib,types}/`

7. New capabilities
- CORS middleware
- A new image output mode alongside video mode
- `YON_IMAGE` anchor-based segmented rendering, multi-image output, and gallery preview in image mode
- Batch image download support
- Reference image input support
- A light Chinese-inspired frontend aesthetic with theme switching, settings modals, and related UI components
- Support for third-party OpenAI-compatible APIs and custom API configuration
- Retry flow and frontend/backend status querying
- Customizable frontend video parameters, effective in video mode only
- Memory monitoring endpoint support
- Dedicated prompt management UI with eight prompt types
- Manual secondary editing and rerendering, plus AI-assisted secondary editing
- Timing breakdown for each stage, shared by both image and video modes
- Backend test endpoint
- Production summary logging mode with token aggregation support
- Server-side upstream mapping by ManimCat key, making it possible to distinguish test and production users
- Frontend multi-profile API polling and sharded routing, with `url/key/model/manimcat key` matched by index
- Workspace: unified full-screen management page combining generation history, prompt management, and usage dashboard with a left rail navigation
- Generation history: persistent history stored in Supabase (text-only: prompt, code, metadata; videos/images are not stored), feature-flagged via `ENABLE_HISTORY_DB`
- Background music: automatic piano BGM mixing after video render (-20dB, random track and start offset, 3-second fade-out), toggleable in video settings
- Standalone render-failure event collection and admin JSON export, capturing failed Manim code snippets from model outputs for debugging and reliability improvements
- A built-in 2048 mini-game during waiting states to make long renders less boring

<details>
  <summary>Prompt feature notes</summary>

### Prompt Types

The system supports **8 prompt types**, divided into two major categories:

#### System prompts
- **conceptDesigner**: system prompt for concept design, guiding the AI to understand the math concept and design the animation scene
- **codeGeneration**: system prompt for code generation, guiding the AI to produce compliant Manim code
- **codeRetry**: retry system prompt, used only during the repair phase after a render failure; the system itself does not "retry" by magic, it simply enters the repair flow with this prompt

#### User prompts
- **conceptDesigner**: user prompt for concept design, adding more specific design needs and stylistic guidance
- **codeGeneration**: user prompt for code generation, adding more detailed requirements and constraints
- **codeRetryInitial**: initial repair prompt used after the first code failure
- **codeRetryFix**: detailed repair prompt used after the second code failure

### Workflow

1. Visit the page by clicking the "Workspace" button in the top-right corner, then select "Prompts" from the left rail
2. Choose the prompt type in the sidebar
3. Edit the prompt content in the main editor area
4. Save or rely on auto-save
5. The new configuration is applied to the next generation task automatically

### Relationship to the main concept input

- **Main page input**: the specific task description you enter for each generation request
- **Prompt management**: global behavioral rules configured once and reused many times
- **Combined use**: the system combines the user's concept input with the configured prompts to generate the final animation

### How prompt overrides work

- **Default priority**: if the user has not modified anything, backend default prompt templates are used
- **Override priority**: once a field is modified, only that field is replaced and the rest continue to use defaults
- **Retry phase**: after the initial generation fails, the repair flow uses `codeRetry` as the system prompt and `codeRetryInitial` / `codeRetryFix` as the user prompts

</details>

## License and Copyright

Licensing details are defined in `LICENSE_POLICY.md` (Chinese) and `LICENSE_POLICY.en.md` (English).

- Third-party attribution and notices: `THIRD_PARTY_NOTICES.md`
- Chinese third-party notices: `THIRD_PARTY_NOTICES.zh-CN.md`

## Maintenance Notes

Because my time is limited and I am an independent hobbyist rather than a full-time professional maintainer, I currently cannot provide fast review cycles or long-term maintenance for external contributions. Pull requests are welcome, but review may take time.

If you have good suggestions or discover a bug, feel free to open an Issue for discussion. I will improve the project at my own pace. If you want to make large-scale changes on top of this work, you are also welcome to fork it and build your own version.

If this project gave you useful ideas or helped you in some way, that is already an honor for me.

<details>
  <summary><b>If you like this project, you can also buy the author a Coke 🥤</b></summary>
  <br />
  <p>Support it here:</p>
  <a href="https://afdian.com/a/wingflow/plan" target="_blank">
    <img src="https://img.shields.io/badge/Support-Aifadian-635cff?style=for-the-badge&logo=shopee&logoColor=white" alt="Support on Aifadian" />
  </a>
  <p><i>Thank you. Your support gives me more energy to keep maintaining the project.</i></p>
</details>

## Acknowledgements

- Original project author
- Linux.do community
- Alibaba Cloud Bailian
