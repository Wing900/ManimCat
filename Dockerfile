# syntax=docker/dockerfile:1

# Build the rendering venv from pinned wheels; ManimGX bundles its Linux lavapipe renderer.
FROM python:3.14-slim AS manim_builder
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.txt /tmp/render-requirements.txt
RUN pip install --no-cache-dir --only-binary=:all: -r /tmp/render-requirements.txt

# Build the small ManimGX web adapter used for clean PNG readback. Keeping this in
# its own pinned stage avoids Docker-in-Docker during the Node build and makes the
# production image reproducible from a clean checkout.
FROM rust:1.90-bookworm@sha256:3914072ca0c3b8aad871db9169a651ccfce30cf58303e5d6f2db16d1d8a7e58f AS browser_engine_builder
RUN apt-get update -qq \
    && apt-get install --no-install-recommends -y ca-certificates curl patch \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /engine-src
COPY scripts/browser-rendering/engine-patch/0001-clean-image-readback.patch /tmp/manimgx-clean-image.patch
RUN curl --fail --location --retry 3 \
      https://codeload.github.com/academa-labs/manimgx/tar.gz/0507708dc5d731478786de2f46ca8a1660d514d6 \
      --output /tmp/manimgx.tar.gz \
    && echo "2637d63014ce10d16a092141e9436c3bf361dc2811bc688d02b2f1e221124de4  /tmp/manimgx.tar.gz" | sha256sum --check --strict \
    && tar -xzf /tmp/manimgx.tar.gz --strip-components=1 -C /engine-src \
    && patch -p1 -i /tmp/manimgx-clean-image.patch \
    && rustup target add wasm32-unknown-unknown \
    && cargo build --manifest-path rust/engine/Cargo.toml --locked --lib --release \
      --target wasm32-unknown-unknown --no-default-features --features web \
      --target-dir /engine-src/rust/target \
    && cargo install wasm-bindgen-cli --version 0.2.128 --locked \
    && mkdir -p /browser-engine \
    && wasm-bindgen --target web --out-dir /browser-engine --out-name engine \
      --no-typescript --omit-default-module-path \
      rust/target/wasm32-unknown-unknown/release/_engine.wasm

# Compile both applications, then retain production Node dependencies only.
FROM node:22-bookworm-slim AS node_builder
ARG VITE_BROWSER_RENDERER_URL
ARG BROWSER_RENDERER_MAIN_ORIGIN
ENV VITE_BROWSER_RENDERER_URL=${VITE_BROWSER_RENDERER_URL}
ENV BROWSER_RENDERER_MAIN_ORIGIN=${BROWSER_RENDERER_MAIN_ORIGIN}
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY scripts ./scripts
RUN npm ci \
    && npm --prefix frontend ci
COPY tsconfig.json ./
COPY frontend ./frontend
COPY src ./src
COPY data ./data
COPY --from=browser_engine_builder /browser-engine /tmp/browser-engine
RUN npm run build:backend \
    && node scripts/browser-rendering/build.mjs --prebuilt-dir /tmp/browser-engine \
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
ENV MANIMCAT_TINI_PROCESS_GROUP=1

RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update -qq \
    && apt-get -o Acquire::Retries=3 install --no-install-recommends -y \
        bubblewrap \
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
        tini \
        util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

COPY --from=manim_builder /opt/venv /opt/venv
COPY --from=node_builder /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY --from=node_builder /app/package.json ./package.json
COPY --from=node_builder /app/node_modules ./node_modules
COPY --from=node_builder /app/dist ./dist
COPY --from=node_builder /app/public ./public
COPY --from=node_builder /app/frontend/dist-browser-renderer ./renderer
COPY --from=node_builder /app/data ./data
COPY --from=node_builder /app/src/prompts/templates ./src/prompts/templates
COPY --from=node_builder /app/src/studio-agent/prompts/templates ./src/studio-agent/prompts/templates
COPY --from=node_builder /app/src/rendering/manim/manimgx-runner.py ./src/rendering/manim/manimgx-runner.py
COPY --from=node_builder /app/src/rendering/manim/narration_runtime.py ./src/rendering/manim/narration_runtime.py
COPY --from=node_builder /app/src/rendering/manim/edge_tts_worker.py ./src/rendering/manim/edge_tts_worker.py
COPY scripts/deploy/start-with-redis-hf.cjs ./scripts/deploy/start-with-redis-hf.cjs
COPY scripts/deploy/container-entrypoint.sh ./scripts/deploy/container-entrypoint.sh

RUN mkdir -p \
        /app/.studio-workspace \
        /app/media \
        /app/public/images \
        /app/public/videos \
        /app/tmp \
        /data/redis \
    # The render subprocess runs through bubblewrap, with only the exact render venv,
    # system runtime, runner files and per-render staging mounted. /app itself is not
    # visible to submitted code; this ownership only lets the server manage its own files.
    && chmod 0755 ./scripts/deploy/container-entrypoint.sh \
    && chown -R node:node /app /data/redis

ENV PORT=7860
EXPOSE 7860

# Drop root for the server process and every renderer it spawns.
USER node

# A private outer user/mount/PID namespace gives bubblewrap a writable,
# namespace-local proc sysctl tree for --disable-userns. The host UID remains
# node; no host capabilities or global sysctl changes are needed. Docker must
# use config/docker/render-sandbox-seccomp.json (wired into docker-compose.yml).
# tini is container PID 1 and forwards Docker stop to the child's process group;
# unshare alone ignores SIGTERM as PID 1 and would force a SIGKILL timeout.
# Kill the child namespace when the launcher exits, including during shutdown.
# Hosts that block unprivileged user namespaces (for example Hugging Face
# Spaces) may set MANIMCAT_CONTAINER_SANDBOX=disabled to run browser-only. The
# switch is explicit; server-side rendering still fails closed because bwrap
# remains mandatory.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/scripts/deploy/container-entrypoint.sh"]

# Probe /health on the configured PORT. timeout/start-period are short enough that a wedged
# container is restarted instead of kept on life support.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "const port=process.env.PORT||3000;const r=require('http').get('http://localhost:'+port+'/health',(x)=>process.exit(x.statusCode===200?0:1));r.on('error',()=>process.exit(1));"

CMD ["node", "scripts/deploy/start-with-redis-hf.cjs"]
