# Multi-stage Dockerfile for WhatsApp API
# Supports development, test, and production builds

# Base stage - Common dependencies
FROM node:18-bullseye-slim AS base

# Install system dependencies for Puppeteer/Chrome
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    ca-certificates \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    libu2f-udev \
    libvulkan1 \
    # Additional dependencies for media processing
    ffmpeg \
    # Process management
    procps \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install tini for proper signal handling (downloaded at build time)
RUN wget -O /usr/local/bin/tini https://github.com/krallin/tini/releases/download/v0.19.0/tini \
    && chmod +x /usr/local/bin/tini

# Set Puppeteer environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory and user
WORKDIR /app
RUN groupadd -r whatsapp && useradd -r -g whatsapp -s /bin/bash whatsapp

# Dependencies stage - Install and cache dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Development stage
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
RUN npm install -g nodemon

# Create necessary directories
RUN mkdir -p .wwebjs_auth .wwebjs_cache logs storage temp \
    && chown -R whatsapp:whatsapp /app

USER whatsapp
EXPOSE 3001

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/usr/local/bin/tini", "--"]
CMD ["npm", "run", "dev"]

# Test stage
FROM base AS test
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY tests ./tests

# Install test dependencies
RUN npm install -g mocha nyc

# Create test directories
RUN mkdir -p .wwebjs_auth .wwebjs_cache logs storage temp coverage \
    && chown -R whatsapp:whatsapp /app

USER whatsapp
EXPOSE 3001

# Use tini as entrypoint for proper signal handling
ENTRYPOINT ["/usr/local/bin/tini", "--"]
CMD ["npm", "run", "test"]

# Build stage - For any build steps needed
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Add any build steps here
RUN npm run build 2>/dev/null || echo "No build step needed"

# Production stage
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Copy application code
COPY src ./src
COPY *.js ./ 2>/dev/null || true

# Create necessary directories with proper permissions
RUN mkdir -p .wwebjs_auth .wwebjs_cache logs storage temp \
    && chown -R whatsapp:whatsapp /app

# Switch to non-root user
USER whatsapp

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD curl -f http://localhost:3001/status || exit 1

# Start command
ENTRYPOINT ["/usr/local/bin/tini", "--"]
CMD ["node", "src/index.js"]