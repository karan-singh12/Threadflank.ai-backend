# syntax=docker/dockerfile:1

# ------------------------------------------------------------------------------
# Stage 1: Build & Compile
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install OpenSSL required by Prisma CLI and engine
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests and Prisma schema first for layer caching
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# Copy source code and TypeScript configurations
COPY tsconfig*.json ./
COPY src ./src/
COPY public ./public/

# Build production NestJS application bundle
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install OpenSSL for Prisma runtime, dumb-init for signal handling, and curl for healthchecks
RUN apt-get update -y && apt-get install -y openssl dumb-init curl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3003
ENV API_PORT=3003

# Copy package files and Prisma schema
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install production dependencies only
RUN npm ci --omit=dev

# Generate Prisma Client in the runtime layer
RUN npx prisma generate

# Copy compiled application code and static assets from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Ensure uploads directories exist with proper permissions
RUN mkdir -p /app/public/uploads /app/public/avatars /app/public/user /app/public/general

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3003/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
