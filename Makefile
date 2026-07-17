.PHONY: install verify verify-integration lint format typecheck test test-coverage \
	test-e2e schemas-validate build clean dev explorer doctor

SHELL := /bin/bash

install:
	pnpm install --frozen-lockfile

## make verify: every offline quality gate. Must pass from a clean checkout.
verify: install format lint typecheck schemas-validate test
	@echo "make verify: OK"

format:
	pnpm run format

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

schemas-validate:
	pnpm run schemas:validate

test:
	pnpm run test

test-coverage:
	pnpm run test:coverage

test-e2e:
	pnpm run test:e2e

## make verify-integration: additional checks that require Docker
## (PostgreSQL adapter parity, container builds). Requires: Docker Engine
## with Compose v2. See docs/deployment.md#prerequisites.
verify-integration:
	@command -v docker >/dev/null 2>&1 || { \
		echo "verify-integration: docker is required and was not found on PATH."; \
		echo "Install Docker Engine + Compose v2, then re-run: make verify-integration"; \
		exit 1; \
	}
	docker compose -f deploy/compose/docker-compose.test.yml up -d --wait
	pnpm run test:integration || (docker compose -f deploy/compose/docker-compose.test.yml down -v && exit 1)
	docker compose -f deploy/compose/docker-compose.test.yml down -v
	@echo "make verify-integration: OK"

build:
	pnpm run build

clean:
	pnpm run clean
	rm -rf node_modules **/node_modules **/dist **/.turbo

dev:
	pnpm --filter @act/api dev

explorer:
	pnpm run dev:explorer

## make doctor: quick environment sanity check (mirrors `act doctor`).
doctor:
	node -e "console.log('node', process.version)"
	pnpm --version
	@command -v docker >/dev/null 2>&1 && docker --version || echo "docker: not found (required only for verify-integration)"
