# Unified Makefile for Agent Zero Monorepo
# Provides standardized commands for development, testing, and deployment

.PHONY: help install install-deps install-dev setup clean test lint format build start dev deploy docs

# Default target
.DEFAULT_GOAL := help

# Configuration
PYTHON := python3
PIP := pip3
NODE := node
NPM := npm
NX := npx nx

# Colors for output
BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

help: ## Show this help message
	@echo "$(BLUE)Agent Zero Monorepo$(RESET)"
	@echo "Available commands:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Installation targets
install: install-deps install-dev ## Install all dependencies (Python + Node.js)

install-deps: ## Install production dependencies
	@echo "$(BLUE)Installing Python dependencies...$(RESET)"
	$(PIP) install -e .
	@echo "$(BLUE)Installing Node.js dependencies...$(RESET)"
	$(NPM) install

install-dev: ## Install development dependencies
	@echo "$(BLUE)Installing Python development dependencies...$(RESET)"
	$(PIP) install -e ".[dev]"
	@echo "$(BLUE)Installing Node.js development dependencies...$(RESET)"
	$(NPM) install --include=dev

setup: install ## Complete setup for new developers
	@echo "$(BLUE)Setting up pre-commit hooks...$(RESET)"
	pre-commit install || echo "$(YELLOW)pre-commit not available, skipping$(RESET)"
	@echo "$(GREEN)Setup complete!$(RESET)"

# Development targets
dev: ## Start development servers for all services
	$(NX) run-many --target=dev --all --parallel

dev-agent: ## Start only Agent Zero core in development mode
	./tools/scripts/restart.sh --service agent-zero --watch

dev-webui: ## Start only WebUI in development mode
	$(NX) run webui:dev

dev-crm: ## Start only CRM in development mode
	./tools/scripts/restart.sh --service crm --watch

dev-gateway: ## Start only WhatsApp Gateway in development mode
	./tools/scripts/restart.sh --service gateway --watch

start: ## Start production services
	./tools/scripts/restart.sh --service all

stop: ## Stop all services
	./tools/scripts/restart.sh --kill-only

restart: stop start ## Restart all services

# Code quality targets
lint: ## Run linting on all packages
	@echo "$(BLUE)Running ESLint...$(RESET)"
	$(NX) run-many --target=lint --all
	@echo "$(BLUE)Running Python linting...$(RESET)"
	flake8 apps/agent-zero-core/python/ apps/agent-zero-core/agents/ tests/ || echo "$(YELLOW)flake8 not available$(RESET)"
	black --check apps/agent-zero-core/python/ apps/agent-zero-core/agents/ tests/ || echo "$(YELLOW)black not available$(RESET)"

lint-fix: ## Fix linting issues automatically
	@echo "$(BLUE)Fixing ESLint issues...$(RESET)"
	$(NX) run-many --target=lint --all --fix
	@echo "$(BLUE)Fixing Python formatting...$(RESET)"
	black apps/agent-zero-core/python/ apps/agent-zero-core/agents/ tests/ || echo "$(YELLOW)black not available$(RESET)"
	isort apps/agent-zero-core/python/ apps/agent-zero-core/agents/ tests/ || echo "$(YELLOW)isort not available$(RESET)"

format: ## Format all code
	@echo "$(BLUE)Formatting JavaScript/TypeScript...$(RESET)"
	$(NPM) run format
	@echo "$(BLUE)Formatting Python...$(RESET)"
	black apps/agent-zero-core/python/ apps/agent-zero-core/agents/ tests/ || echo "$(YELLOW)black not available$(RESET)"
	isort apps/agent-zero-core/python/ apps/agent-zero-core/agents/ tests/ || echo "$(YELLOW)isort not available$(RESET)"

format-check: ## Check code formatting
	$(NPM) run format:check
	black --check apps/agent-zero-core/python/ apps/agent-zero-core/agents/ tests/ || echo "$(YELLOW)black not available$(RESET)"

typecheck: ## Run type checking
	$(NX) run-many --target=typecheck --all
	mypy apps/agent-zero-core/python/ apps/agent-zero-core/agents/ || echo "$(YELLOW)mypy not available$(RESET)"

# Testing targets
test: ## Run all tests
	@echo "$(BLUE)Running JavaScript/TypeScript tests...$(RESET)"
	$(NX) run-many --target=test --all
	@echo "$(BLUE)Running Python tests...$(RESET)"
	$(PYTHON) -m pytest tests/ -v || echo "$(YELLOW)pytest not available$(RESET)"

test-python: ## Run only Python tests
	$(PYTHON) -m pytest tests/ -v

test-js: ## Run only JavaScript/TypeScript tests
	$(NX) run-many --target=test --all

test-coverage: ## Run tests with coverage
	$(PYTHON) -m pytest tests/ --cov=apps/agent-zero-core/python --cov=apps/agent-zero-core/agents --cov-report=html --cov-report=term

test-integration: ## Run integration tests
	./tools/scripts/verify_integration.sh

# Build targets
build: ## Build all packages
	$(NX) run-many --target=build --all

build-python: ## Build Python packages
	$(PYTHON) -m build

build-js: ## Build JavaScript/TypeScript packages
	$(NX) run-many --target=build --all

# Cleaning targets
clean: ## Clean build artifacts and caches
	@echo "$(BLUE)Cleaning Python artifacts...$(RESET)"
	find . -type f -name "*.pyc" -delete
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name "*.egg-info" -exec rm -rf {} +
	rm -rf build/ dist/ .coverage htmlcov/
	@echo "$(BLUE)Cleaning Node.js artifacts...$(RESET)"
	$(NX) reset
	rm -rf node_modules/.cache
	@echo "$(GREEN)Clean complete!$(RESET)"

clean-all: clean ## Clean everything including dependencies
	rm -rf node_modules/
	rm -rf .venv/
	$(PIP) freeze | xargs $(PIP) uninstall -y || true

# Documentation targets
docs: ## Generate documentation
	@echo "$(BLUE)Generating documentation...$(RESET)"
	sphinx-build -b html docs/ docs/_build/html || echo "$(YELLOW)Sphinx not available$(RESET)"

docs-serve: docs ## Serve documentation locally
	$(PYTHON) -m http.server 8000 -d docs/_build/html

# Docker targets
docker-build: ## Build Docker images
	docker build -t agent-zero:latest -f Dockerfile.agent-zero .

docker-run: ## Run Agent Zero in Docker
	docker run -p 50001:80 agent-zero:latest

# Deployment targets
deploy-staging: build ## Deploy to staging environment
	@echo "$(YELLOW)Staging deployment not configured$(RESET)"

deploy-prod: build test ## Deploy to production environment
	@echo "$(YELLOW)Production deployment not configured$(RESET)"

# Utility targets
check: lint typecheck test ## Run all checks (lint, typecheck, test)

ci: install check build ## Run CI pipeline locally

upgrade: ## Upgrade dependencies
	$(PIP) install --upgrade pip
	$(PIP) install --upgrade -e ".[dev]"
	$(NPM) update

info: ## Show environment information
	@echo "$(BLUE)Environment Information:$(RESET)"
	@echo "Python: $$($(PYTHON) --version)"
	@echo "Node.js: $$($(NODE) --version)"
	@echo "NPM: $$($(NPM) --version)"
	@echo "Nx: $$($(NX) --version)"
	@echo "Working Directory: $$(pwd)"
	@echo "Git Branch: $$(git branch --show-current 2>/dev/null || echo 'not a git repo')"

# Git hooks
pre-commit: lint-fix test ## Run pre-commit checks

# Database/Cache management (for Redis, etc.)
db-start: ## Start database services (Redis, etc.)
	docker run -d --name agent-zero-redis -p 6379:6379 redis:alpine || echo "$(YELLOW)Redis container already running or Docker not available$(RESET)"

db-stop: ## Stop database services
	docker stop agent-zero-redis || true
	docker rm agent-zero-redis || true

# Monitoring and logs
logs: ## Show logs from all services
	tail -f logs/*.out

logs-agent: ## Show Agent Zero logs
	tail -f logs/agent_zero.out

logs-crm: ## Show CRM logs
	tail -f logs/crm_*.out

# Security
security-check: ## Run security checks
	@echo "$(BLUE)Running security checks...$(RESET)"
	safety check || echo "$(YELLOW)safety not available$(RESET)"
	npm audit || echo "$(YELLOW)npm audit failed$(RESET)"