# ManimCat - Production Dockerfile

# Stage 1: Build frontend
FROM node:20-bookworm AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package.json frontend/package-lock.json* ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Stage 2: Build backend
FROM node:20-bookworm AS backend-builder

WORKDIR /app

# Copy backend package files
COPY package.json package-lock.json* ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy backend source
COPY src/ ./src/

# Build backend
RUN npm run build:backend

# Stage 3: Production image
FROM python:3.11-slim-bookworm

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    XDG_RUNTIME_DIR=/tmp/runtime-manimcat \
    DISPLAY=:99 \
    NODE_ENV=production \
    PORT=3000

# Install Node.js 20.x and dependencies in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Node.js setup
    ca-certificates \
    curl \
    gnupg \
    # Build tools
    build-essential \
    pkg-config \
    # Manim dependencies
    libcairo2-dev \
    libpango1.0-dev \
    libgif-dev \
    libopenblas-dev \
    gfortran \
    ffmpeg \
    xvfb \
    # LaTeX packages
    texlive-latex-base \
    texlive-fonts-recommended \
    texlive-latex-recommended \
    cm-super \
    dvipng \
    dvisvgm && \
    # Install Node.js
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    # Cleanup
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install Manim and Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir manim==0.18.0 numpy scipy pillow && \
    rm -rf /root/.cache

# Create app user and directories
RUN useradd -m -u 1000 node && \
    mkdir -p /app/public/videos /app/tmp && \
    chown -R node:node /app

WORKDIR /app

# Copy backend build artifacts
COPY --from=backend-builder --chown=node:node /app/dist ./dist
COPY --from=backend-builder --chown=node:node /app/package.json ./

# Copy frontend build to public directory
COPY --from=frontend-builder --chown=node:node /app/frontend/dist ./public

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && \
    npm cache clean --force && \
    chown -R node:node /app

# Switch to non-root user
USER node

# Set proper permissions
RUN chmod -R 755 /app/public /app/tmp

# Expose port
EXPOSE 3000

# Health check (using node instead of curl for smaller image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start Xvfb and Express server
CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset & node dist/server.js"]
