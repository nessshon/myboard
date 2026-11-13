.PHONY: dev web build check

VERSION := $(shell git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.Version=$(VERSION)
BUILD := -trimpath -tags no_ui
GO_DIRS := cmd config internal web
ENV := set -a; [ -f .env ] && . ./.env; set +a;

dev: web/node_modules
	@trap 'kill 0' EXIT; (cd web && npm run dev) & $(ENV) go run -tags no_ui ./cmd serve --dev --http 127.0.0.1:8090

web: web/node_modules
	cd web && npm run build

web/node_modules: web/package-lock.json
	cd web && npm ci

build: web
	go build $(BUILD) -ldflags "$(LDFLAGS)" -o build/myboard ./cmd

check: web
	@test -z "$$(gofmt -l $(GO_DIRS))" || (gofmt -l $(GO_DIRS) && exit 1)
	go vet $(GO_DIRS:%=./%/...)
	go test $(GO_DIRS:%=./%/...)
	cd web && npm run typecheck && npm run format:check
