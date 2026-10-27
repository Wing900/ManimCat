# syntax=docker/dockerfile:1

# Hugging Face source sync can omit binary tracks. Fetch them in a disposable stage so
# curl and its package metadata never enter the runtime image.
FROM alpine:3.22 AS audio_assets
RUN apk add --no-cache ca-certificates curl \
    && mkdir -p /tracks \
    && for file in \
        clavier-music-soft-piano-music-312509.mp3 \
        the_mountain-soft-piano-background-444129.mp3 \
        viacheslavstarostin-relaxing-soft-piano-music-431679.mp3; do \
        curl -fL --retry 8 --retry-delay 3 --connect-timeout 10 --max-time 120 \
            -o "/tracks/$file" \
            "https://raw.githubusercontent.com/Wing900/ManimCat/main/src/audio/tracks/$file"; \
    done

# Build the rendering venv from pinned wheels; ManimGX bundles its Linux lavapipe renderer.
FROM python:3.14-slim AS manim_builder
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt /tmp/render-requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r /tmp/render-requirements.txt

# Compile both applications, then retain production Node dependencies only.
FROM node:22-bookworm-slim AS node_builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY scripts/prune-onnxruntime-web.mjs ./scripts/
RUN npm ci \
    && npm --prefix frontend ci
COPY tsconfig.json ./
COPY frontend ./frontend
COPY src ./src
COPY data ./data
RUN npm run build \
    && node scripts/prune-onnxruntime-web.mjs \
    && npm prune --omit=dev

# Runtime contains rendering and serving capabilities only.
FROM python:3.14-slim AS runtime
RUN groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --create-home node
ENV HOME=/home/node
ENV VIRTUAL_ENV=/opt/venv
ENV PATH=/opt/venv/bin:$PATH
ENV NODE_ENV=production

RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update -qq \
    && apt-get -o Acquire::Retries=3 install --no-install-recommends -y \
        ca-certificates \
        ffmpeg \
        fontconfig \
        fonts-noto-cjk \
        fonts-noto-core \
        libegl1 \
        libgcc-s1 \
        libvulkan1 \
        libxext6 \
        libstdc++6 \
        mesa-vulkan-drivers \
        redis-server \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

COPY --from=manim_builder /opt/venv /opt/venv
COPY --from=node_builder /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY --from=node_builder /app/package.json ./package.json
COPY --from=node_builder /app/node_modules ./node_modules
COPY --from=node_builder /app/dist ./dist
COPY --from=node_builder /app/public ./public
COPY --from=node_builder /app/data ./data
COPY --from=node_builder /app/src/prompts/templates ./src/prompts/templates
COPY --from=node_builder /app/src/studio-agent/prompts/templates ./src/studio-agent/prompts/templates
COPY --from=node_builder /app/src/rendering/manim/manimgx-runner.py ./src/rendering/manim/manimgx-runner.py
COPY --from=node_builder /app/src/rendering/manim/narration_runtime.py ./src/rendering/manim/narration_runtime.py
COPY --from=node_builder /app/src/rendering/manim/edge_tts_worker.py ./src/rendering/manim/edge_tts_worker.py
COPY --from=audio_assets /tracks ./src/audio/tracks
COPY start-with-redis-hf.cjs ./

RUN mkdir -p \
        /app/.studio-workspace \
        /app/media \
        /app/public/images \
        /app/public/videos \
        /app/tmp \
        /data/redis \
    # The render subprocess (ManimGX / python) runs as `node` and must not be able to write outside
    # /app and /data/redis. Owning /app also means a sandboxed renderer cannot mutate /usr/local
    # or /opt/venv, even before a proper sandbox is added.
    && chown -R node:node /app /data/redis

ENV PORT=7860
EXPOSE 7860

# Drop root for the server process and every renderer it spawns.
USER node

# Probe /health on the configured PORT. timeout/start-period are short enough that a wedged
# container is restarted instead of kept on life support.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const port=process.env.PORT||3000;const r=require('http').get('http://localhost:'+port+'/health',(x)=>process.exit(x.statusCode===200?0:1));r.on('error',()=>process.exit(1));"

CMD ["node", "start-with-redis-hf.cjs"]
