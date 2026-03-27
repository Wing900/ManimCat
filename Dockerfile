# =========================================
# 阶段 1: 准备 Node 环境
# =========================================
FROM node:22-bookworm-slim AS node_base

# =========================================
# 阶段 2: 构建最终镜像 (基于 Manim)
# =========================================
FROM manimcommunity/manim:stable
USER root

# 1. 复制 Node.js (从 node_base 偷过来)
COPY --from=node_base /usr/local/bin /usr/local/bin
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules

# 2. 【关键】安装 Redis 和中文字体，并刷新字体缓存
# 使用阿里云源加速
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y redis-server fontconfig \
    fonts-noto-cjk fonts-noto-cjk-extra \
    fonts-wqy-zenhei fonts-wqy-microhei fonts-lxgw-wenkai \
    ffmpeg curl ca-certificates && \
    fc-cache -f -v

# 2.1 安装 Python 运行时与静态检查依赖
#     显式声明 matplotlib，避免依赖基础镜像的隐式预装状态。
RUN python -m pip install --no-cache-dir \
    matplotlib \
    mypy==1.19.1

WORKDIR /app

# 3. 复制 package.json
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package-lock.json* ./frontend/

# 4. 设置 npm 淘宝源
RUN npm config set registry https://registry.npmmirror.com

# 5. 安装依赖
RUN npm install && npm --prefix frontend install

# 6. 复制源码并构建 React
COPY . .

# 7. 下载 BGM 音频文件（HF Space 同步时可能排除二进制文件）
#    之前写法使用了 `... && ... && ... || true`，会把前面下载失败静默吞掉。
RUN set -eux; \
    mkdir -p src/audio/tracks; \
    for file in \
      clavier-music-soft-piano-music-312509.mp3 \
      the_mountain-soft-piano-background-444129.mp3 \
      viacheslavstarostin-relaxing-soft-piano-music-431679.mp3; do \
      rm -f "src/audio/tracks/$file"; \
      for url in \
        "https://raw.githubusercontent.com/Wing900/ManimCat/main/src/audio/tracks/$file" \
        "https://github.com/Wing900/ManimCat/raw/main/src/audio/tracks/$file"; do \
        echo "Downloading $file from $url"; \
        if curl -fL --retry 8 --retry-delay 3 --connect-timeout 10 --max-time 120 -o "src/audio/tracks/$file" "$url"; then \
          break; \
        fi; \
      done; \
      if [ ! -s "src/audio/tracks/$file" ]; then \
        echo "WARNING: failed to download $file"; \
        rm -f "src/audio/tracks/$file"; \
      fi; \
    done; \
    echo "Downloaded tracks:"; \
    ls -lh src/audio/tracks || true; \
    track_count="$(find src/audio/tracks -maxdepth 1 -type f -name '*.mp3' | wc -l)"; \
    echo "BGM track count: $track_count"; \
    if [ "$track_count" -eq 0 ]; then \
      echo "ERROR: no BGM tracks available after download"; \
      exit 1; \
    fi

RUN npm run build

ENV PORT=7860
EXPOSE 7860

CMD ["node", "start-with-redis-hf.cjs"]
