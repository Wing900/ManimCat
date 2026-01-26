# =========================================
# 阶段 1: 准备 Node 环境
# =========================================
FROM node:18-bookworm-slim AS node_base

# =========================================
# 阶段 2: 构建最终镜像 (基于 Manim)
# =========================================
FROM manimcommunity/manim:stable
USER root

# 1. 复制 Node.js (从 node_base 偷过来)
COPY --from=node_base /usr/local/bin /usr/local/bin
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules

# 2. 【关键】安装 Redis 和 中文字体 (fonts-noto-cjk)
# 使用阿里云源加速
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    apt-get install -y redis-server fonts-noto-cjk

WORKDIR /app

# 3. 复制 package.json
COPY package.json package-lock.json* ./

# 4. 设置 npm 淘宝源
RUN npm config set registry https://registry.npmmirror.com

# 5. 安装依赖
RUN npm install

# 6. 复制源码并构建 React
COPY . .
RUN npm run build

# 7. 启动脚本
RUN printf '#!/bin/bash\nredis-server --daemonize yes\nnpm run start' > /app/start.sh && chmod +x /app/start.sh

ENV PORT=7860
EXPOSE 7860

CMD ["/app/start.sh"]

