SHELL := /bin/bash

.PHONY: dev-all e2e-smoke e2e-ci e2e-health

dev-all:
	@chmod +x scripts/dev-all-watch.sh || true
	@scripts/dev-all-watch.sh

e2e-smoke:
	@bash scripts/e2e.sh smoke

e2e-ci:
	@bash scripts/e2e.sh ci-smoke

e2e-health:
	@bash scripts/e2e.sh health
