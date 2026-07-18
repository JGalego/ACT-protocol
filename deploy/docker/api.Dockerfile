# syntax=docker/dockerfile:1.7
#
# Multi-stage build for services/api. The builder stage needs the whole
# pnpm workspace (services/api depends on packages/core, packages/crypto,
# packages/ledger, packages/policy, packages/verification via
# `workspace:*`); `pnpm deploy` then prunes that down to a self-contained,
# production-only directory for the runtime stage, so the final image
# contains no other workspace package's source, no devDependencies, and no
# monorepo tooling.
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm --filter @act/api deploy --prod /out/api

FROM node:22-alpine AS runtime
RUN addgroup -S act && adduser -S act -G act
WORKDIR /app
COPY --from=builder --chown=act:act /out/api .
USER act
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
