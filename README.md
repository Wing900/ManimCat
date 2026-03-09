---
title: ManimCat
emoji: 🐱
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

English | [简体中文](./README.zh-CN.md)

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
  <img src="https://img.shields.io/badge/License-MIT-607D8B?style=for-the-badge" alt="License" />
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

### 01

> Use a two-column layout to explain the relationship between sinusoidal stretching transformations and their analytic expressions.

<div align="center">   <video src="https://github.com/user-attachments/assets/56528268-972d-45f6-9145-0531337cbffa" width="80%" autoplay loop muted playsinline>   </video>   <p><i>example01</i></p> </div>

### 02

> Draw a unit circle and generate the sine function.

<div align="center">

  <video src="https://github.com/user-attachments/assets/0fa7b853-7388-466c-ae46-93cf009277c4" width="80%" autoplay loop muted playsinline>
  </video>
  <p><i>example02</i></p>
</div>

### 03

> Prove that $1/4 + 1/16 + 1/64 + \dots = 1/3$ using a beautiful geometric method, elegant zooming, smooth camera movement, a slow pace, at least two minutes of duration, clear logic, a creamy yellow background, and a macaroon-inspired palette.

<div align="center">

  <video src="https://github.com/user-attachments/assets/c48021ed-d5c4-4be1-b09e-8d3a716d8d10" width="80%" autoplay loop muted playsinline>
  </video>
  <p><i>example03</i></p>
</div>


## Technology

### Tech Stack

**Backend**
- Express.js (`package.json`: `^4.18.0`, current `package-lock.json`: `4.22.1`) + TypeScript `5.9.3`
- Bull `4.16.5` + ioredis `5.9.2` for the Redis-backed job queue
- OpenAI SDK (`package.json`: `^4.50.0`, current `package-lock.json`: `4.104.0`)
- Zod (`package.json`: `^3.23.0`, current `package-lock.json`: `3.25.76`) for data validation

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
| `OPENAI_API_KEY` | - | Default backend AI API key. Not required if everything is routed through route/custom API config |
| `OPENAI_MODEL` | `glm-4-flash` | OpenAI model |
| `OPENAI_TIMEOUT` | `600000` | OpenAI request timeout in milliseconds |
| `CUSTOM_API_URL` | - | Custom OpenAI-compatible API endpoint |
| `MANIMCAT_ROUTE_KEYS` | - | List of ManimCat keys for upstream mapping, separated by commas or new lines |
| `MANIMCAT_ROUTE_API_URLS` | - | Upstream API URLs matched to `MANIMCAT_ROUTE_KEYS` by index |
| `MANIMCAT_ROUTE_API_KEYS` | - | Upstream API keys matched to `MANIMCAT_ROUTE_KEYS` by index |
| `MANIMCAT_ROUTE_MODELS` | - | Upstream models, optional, falls back to `OPENAI_MODEL` when omitted |
| `AI_TEMPERATURE` | `0.7` | Generation temperature |
| `AI_MAX_TOKENS` | `1200` | Maximum generation tokens |
| `DESIGNER_TEMPERATURE` | `0.8` | Designer temperature |
| `DESIGNER_MAX_TOKENS` | `12000` | Maximum designer tokens |
| `REQUEST_TIMEOUT` | `600000` | Request timeout in milliseconds |
| `JOB_TIMEOUT` | `600000` | Job timeout in milliseconds |
| `MANIM_TIMEOUT` | `600000` | Manim render timeout in milliseconds |
| `LOG_LEVEL` | `info` | Log level (`debug/info/warn/error`) |
| `PROD_SUMMARY_LOG_ONLY` | `true` | In production, only emit one summary log line per job |
| `OPENAI_STREAM_INCLUDE_USAGE` | `false` | Whether to try recording usage tokens for streaming requests, if the upstream supports it |
| `CODE_RETRY_MAX_RETRIES` | `4` | Number of code-fix retries |
| `MEDIA_RETENTION_HOURS` | `72` | Retention period for image and video files |
| `MEDIA_CLEANUP_INTERVAL_MINUTES` | `60` | Media cleanup interval in minutes |
| `JOB_RESULT_RETENTION_HOURS` | `24` | Retention period for job results and stage data |
| `USAGE_RETENTION_DAYS` | `90` | Retention period for daily aggregated usage metrics |
| `METRICS_USAGE_RATE_LIMIT_MAX` | `30` | Maximum number of usage requests per IP in each rate limit window |
| `METRICS_USAGE_RATE_LIMIT_WINDOW_MS` | `60000` | Usage API rate limit window in milliseconds |

**Example `.env`**

```bash
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
OPENAI_API_KEY=your-api-key-here
OPENAI_MODEL=glm-4-flash
OPENAI_TIMEOUT=600000
AI_TEMPERATURE=0.7
CODE_RETRY_MAX_RETRIES=4
MANIMCAT_ROUTE_KEYS=user_key_a,user_key_b
MANIMCAT_ROUTE_API_URLS=https://api-a.example.com/v1,https://api-b.example.com/v1
MANIMCAT_ROUTE_API_KEYS=sk-a,sk-b
MANIMCAT_ROUTE_MODELS=qwen3.5-plus,gemini-3-flash-preview
```

**Upstream selection priority, from high to low**

1. `MANIMCAT_ROUTE_*` matching the current Bearer key
2. `customApiConfig` in the request body
3. Server defaults: `OPENAI_API_KEY + OPENAI_MODEL + CUSTOM_API_URL`

## Deployment

Please see the [deployment guide](./DEPLOYMENT.md).

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
- `src/{config,middlewares,routes,services,queues,prompts,types,utils}/`
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

1. Visit the page by clicking the "Prompt Manager" button in the top-right corner of the main interface
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

### 1. Software License

The backend architecture and parts of the frontend implementation in this project reference or build upon the core ideas of [manim-video-generator](https://github.com/rohitg00/manim-video-generator).

- Inherited portions of the code remain under the **MIT License**
- The new refactored code, queue logic, and frontend components added by this project are also released to the open-source community under the **MIT License**

### 2. Copyright Notice for Core Assets

**The following content is original work by me, the author of ManimCat, and is strictly prohibited from commercial use in any form:**

- **Prompt engineering**: all highly optimized Manim code generation prompts and related logic under `src/prompts/`
- **API index data**: the Manim v0.18.2 API index tables and related high-constraint rules that I personally crawled, cleaned, and produced
- **Specific algorithmic logic**: regex-based cleanup logic for reasoning-model output and fallback tolerance mechanisms

**Without my written permission, no one may use the above "core assets" for any of the following:**
1. Packaging them directly into a paid product
2. Integrating them into a paid subscription-based commercial AI service
3. Redistributing them for profit without attribution

> In practice, I have already noticed closed-source commercial projects charging math educators high fees by using similar AI + Manim ideas. Yet the open-source world still lacks mature tools deeply optimized for educational use cases.

> ManimCat was created precisely to challenge those closed-source commercial tools. I want every teacher to enjoy AI-powered teaching visualization at a low cost through open source. In practice, you only need to pay for API usage, and fortunately those costs are still inexpensive with strong Chinese LLMs. To protect that vision from being copied by commercial actors and turned back against users, I firmly prohibit commercial licensing of this project's core prompts and index data.

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
