# syntax=docker/dockerfile:1.7
#
# Multi-stage build for apps/explorer: a static Vite build served by an
# unprivileged nginx (nginxinc/nginx-unprivileged runs as uid 101 by
# default and listens on 8080, not port 80, so no root is required at any
# point in the runtime image).
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG EXPLORER_BASE_PATH=/
ENV EXPLORER_BASE_PATH=${EXPLORER_BASE_PATH}
RUN pnpm --filter @act/explorer run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY --from=builder /repo/apps/explorer/dist /usr/share/nginx/html
COPY deploy/docker/explorer-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
