# Build stage: full toolchain, discarded afterwards.
FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

# Copy manifests first so the dependency layer caches across source changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Reinstall without dev dependencies for the runtime image.
RUN pnpm prune --prod

# Runtime stage: no compiler, no dev dependencies.
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Run unprivileged. The node image already provides this user.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# The JSON driver writes here; mount a volume to survive container replacement.
VOLUME ["/app/data"]

# Signals reach the process directly so graceful shutdown flushes pending writes.
CMD ["node", "dist/index.js"]
