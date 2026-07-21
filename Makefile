# AnvilNote ai-writer Makefile
# A thin wrapper around pnpm so common workflows share one entry point.
# All comments are written in plain English without parentheses.

# Use pnpm as the package manager for every target.
PM := pnpm

# Treat these targets as commands rather than files on disk.
.PHONY: help install build typecheck lint check test test-dist verify clean reset

# Show this help message when make runs without a target.
.DEFAULT_GOAL := help

help: ## List all available targets with a short description
	@echo "AnvilNote ai-writer - available make targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "} {printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install all project dependencies from the lockfile
	$(PM) install

build: ## Compile the TypeScript source and copy assets into dist
	$(PM) build

typecheck: ## Run the TypeScript compiler in no-emit mode for source and tests
	$(PM) typecheck

lint: ## Run ESLint across the whole project
	$(PM) lint

# Run linting and type checking together as a quick quality gate.
check: lint typecheck ## Run lint and typecheck in sequence

test: ## Run the source test suite
	$(PM) test

test-dist: ## Run the compiled-output test suite
	$(PM) test:dist

verify: ## Run lint, typecheck, tests, and a clean build against the compiled output
	$(PM) verify

clean: ## Remove build output and local caches
	$(PM) clean

# Wipe installed dependencies on top of the normal clean step.
reset: clean ## Remove node_modules in addition to build output
	rm -rf node_modules
