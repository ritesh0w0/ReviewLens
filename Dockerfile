# Multi-stage Dockerfile for ReviewLens Server (API, Worker, Migration)
# Base image: Node.js 24 on Debian Bookworm Slim

# Stage 1: Build stage
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Configure apt for reliable IPv4 network resolution and install OpenSSL
RUN echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4 && \
    apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy package manifests for workspace installation
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/eval/package.json ./packages/eval/

# Install all dependencies
RUN npm ci

# Copy Prisma schema and config
COPY prisma ./prisma
COPY prisma.config.ts ./

# Copy core workspace and build it
COPY packages/core ./packages/core
RUN npm run build --workspace=@reviewlens/core

# Copy API source code
COPY apps/api ./apps/api

# Generate Prisma client
RUN npx prisma generate

# Build backend
RUN npm run build --workspace=@reviewlens/api

# Stage 2: Production runtime stage
FROM node:24-bookworm-slim AS runner

WORKDIR /app

# Configure apt for reliable IPv4 network resolution and install OpenSSL runtime
RUN echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4 && \
    apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3001

# Copy package manifests
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/eval/package.json ./packages/eval/

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy Prisma CLI and schema for migration execution
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Copy compiled backend and core workspace outputs
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Secure container: run as non-root user
USER node

EXPOSE 3001

CMD ["node", "apps/api/dist/server.js"]
