# syntax=docker/dockerfile:1

# Exact Node LTS tag for reproducibility. For fully immutable builds, pin by digest
# (node:26.13.0-slim@sha256:...).
ARG NODE_IMAGE=node:26.13.0-slim

# ---- build: compile TypeScript with full dev dependencies ----------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: no dependency needs an install script, and it blocks
# swagger-ui's analytics postinstall.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: runtime dependencies only --------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- runtime -------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MOVIES_DB_PATH=/app/db/movies.db \
    RATINGS_DB_PATH=/app/db/ratings.db

# Application files stay root-owned, so the non-root process can't modify them.
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Databases are not baked in; mount them read-only at /app/db (see compose.yaml).
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Run node directly (no npm wrapper) so SIGTERM reaches the app's shutdown handler.
CMD ["node", "dist/server.js"]
