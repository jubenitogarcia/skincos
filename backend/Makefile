SHELL := /bin/bash
BACKEND_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: dev-all dev-gateway dev-official e2e-smoke e2e-ci e2e-health dev restart stop start
.PHONY: var-migrate var-migrate-apply
.PHONY: scraper scraper-all scraper-bss scraper-nh scraper-rj scraper-diagnose scraper-configure scraper-test-sheets
.PHONY: scheduled-posting xiaomi-token
.PHONY: sprinta sprinta-legacy sprinta-v2
.PHONY: actual-server actual-server-start actual-server-menu

dev-all:
	@bash $(BACKEND_DIR)/scripts/dev.sh watch

dev-gateway:
	@bash $(BACKEND_DIR)/scripts/dev.sh gateway --instance $(or $(INST),1)

dev-official:
	@bash $(BACKEND_DIR)/scripts/dev.sh official --instance $(or $(INST),1)

e2e-smoke:
	@bash $(BACKEND_DIR)/scripts/e2e.sh smoke

e2e-ci:
	@bash $(BACKEND_DIR)/scripts/e2e.sh ci-smoke

e2e-health:
	@bash $(BACKEND_DIR)/scripts/e2e.sh health

var-migrate:
	@chmod +x $(BACKEND_DIR)/scripts/migrate-var.sh || true
	@$(BACKEND_DIR)/scripts/migrate-var.sh --dry-run

var-migrate-apply:
	@chmod +x $(BACKEND_DIR)/scripts/migrate-var.sh || true
	@$(BACKEND_DIR)/scripts/migrate-var.sh --apply

restart:
	@bash $(BACKEND_DIR)/scripts/dev.sh restart

start:
	@bash $(BACKEND_DIR)/scripts/dev.sh start

stop:
	@bash $(BACKEND_DIR)/scripts/dev.sh stop

dev:
	@bash $(BACKEND_DIR)/scripts/dev.sh restart

scraper:
	@bash $(BACKEND_DIR)/scripts/dev.sh scraper

scraper-all:
	@bash $(BACKEND_DIR)/scripts/dev.sh scraper all

scraper-bss:
	@bash $(BACKEND_DIR)/scripts/dev.sh scraper bss

scraper-nh:
	@bash $(BACKEND_DIR)/scripts/dev.sh scraper nh

scraper-rj:
	@bash $(BACKEND_DIR)/scripts/dev.sh scraper rj

scraper-diagnose:
	@bash $(BACKEND_DIR)/scripts/dev.sh scraper diagnose

scraper-configure:
	@bash $(BACKEND_DIR)/scripts/dev.sh scraper configure

scraper-test-sheets:
	@bash $(BACKEND_DIR)/scripts/dev.sh scraper --test-sheets

scheduled-posting:
	@bash $(BACKEND_DIR)/scripts/dev.sh scheduled-posting

xiaomi-token:
	@bash $(BACKEND_DIR)/scripts/dev.sh xiaomi-token

sprinta:
	@bash $(BACKEND_DIR)/scripts/dev.sh sprinta

sprinta-legacy:
	@bash $(BACKEND_DIR)/scripts/dev.sh sprinta legacy

sprinta-v2:
	@bash $(BACKEND_DIR)/scripts/dev.sh sprinta v2

actual-server:
	@bash $(BACKEND_DIR)/scripts/dev.sh actual-server menu

actual-server-start:
	@bash $(BACKEND_DIR)/scripts/dev.sh actual-server start

actual-server-menu:
	@bash $(BACKEND_DIR)/scripts/dev.sh actual-server menu

# ---------------------------------------------------------------------------
# Sales Chart Messenger (WhatsApp automation)
# ---------------------------------------------------------------------------
.PHONY: sales-chart-messenger sales-chart-messenger-help sales-chart-messenger-install sales-chart-messenger-install-dev
.PHONY: sales-chart-messenger-setup-local sales-chart-messenger-setup-local-config sales-chart-messenger-setup-local-env
.PHONY: sales-chart-messenger-lint sales-chart-messenger-format sales-chart-messenger-type-check sales-chart-messenger-test
.PHONY: sales-chart-messenger-test-coverage sales-chart-messenger-validate sales-chart-messenger-clean
.PHONY: sales-chart-messenger-diagnose sales-chart-messenger-run-bss-morning sales-chart-messenger-run-bss-evening
.PHONY: sales-chart-messenger-run-nh-morning sales-chart-messenger-run-nh-evening
.PHONY: sales-chart-messenger-test-bss-morning sales-chart-messenger-test-bss-evening
.PHONY: sales-chart-messenger-test-nh-morning sales-chart-messenger-test-nh-evening

sales-chart-messenger:
	@bash $(BACKEND_DIR)/scripts/dev.sh sales-chart-messenger

sales-chart-messenger-help:
	@bash $(BACKEND_DIR)/apps/automations/sales_chart_messenger/scripts/run.sh --help || true

sales-chart-messenger-install:
	@python3 -m pip install -r $(BACKEND_DIR)/requirements.txt

sales-chart-messenger-install-dev:
	@python3 -m pip install -r $(BACKEND_DIR)/requirements.txt
	@python3 -m pip install -r $(BACKEND_DIR)/requirements-dev.txt

sales-chart-messenger-setup-local-config:
			@if [ ! -f $(BACKEND_DIR)/config.json ]; then \
				if [ -f $(BACKEND_DIR)/config/templates/modules/whatsapp-sales-charts/config.example.json ]; then \
					cp $(BACKEND_DIR)/config/templates/modules/whatsapp-sales-charts/config.example.json $(BACKEND_DIR)/config.json; \
					echo "✅ Created config.json from config/templates/modules/whatsapp-sales-charts/config.example.json"; \
				else \
					echo "❌ Missing config/templates/modules/whatsapp-sales-charts/config.example.json"; exit 1; \
				fi; \
			else \
				echo "✅ config.json already present"; \
			fi

sales-chart-messenger-setup-local-env:
			@if [ ! -f $(BACKEND_DIR)/.env ]; then \
				if [ -f $(BACKEND_DIR)/config/templates/modules/whatsapp-sales-charts/.env.example ]; then \
					cp $(BACKEND_DIR)/config/templates/modules/whatsapp-sales-charts/.env.example $(BACKEND_DIR)/.env; \
					echo "✅ Created .env from config/templates/modules/whatsapp-sales-charts/.env.example"; \
				else \
					echo "⚠️ config/templates/modules/whatsapp-sales-charts/.env.example not found (optional)"; \
				fi; \
			else \
				echo "✅ .env already present"; \
			fi

sales-chart-messenger-setup-local: sales-chart-messenger-setup-local-config sales-chart-messenger-setup-local-env

	sales-chart-messenger-lint:
		@python3 -m flake8 $(BACKEND_DIR)/apps/automations/sales_chart_messenger $(BACKEND_DIR)/config $(BACKEND_DIR)/libs/whatsapp_integration

	sales-chart-messenger-format:
		@python3 -m black $(BACKEND_DIR)/apps/automations/sales_chart_messenger $(BACKEND_DIR)/config $(BACKEND_DIR)/libs/whatsapp_integration
		@python3 -m isort $(BACKEND_DIR)/apps/automations/sales_chart_messenger $(BACKEND_DIR)/config $(BACKEND_DIR)/libs/whatsapp_integration

	sales-chart-messenger-type-check:
		@python3 -m mypy $(BACKEND_DIR)/apps/automations/sales_chart_messenger $(BACKEND_DIR)/config $(BACKEND_DIR)/libs/whatsapp_integration

sales-chart-messenger-test:
	@cd $(BACKEND_DIR) && python3 -m pytest

	sales-chart-messenger-test-coverage:
		@cd $(BACKEND_DIR) && python3 -m pytest --cov=apps/automations/sales_chart_messenger --cov=config --cov=libs/whatsapp_integration --cov-report=term

	sales-chart-messenger-validate:
		@cd $(BACKEND_DIR) && python3 -m pip check
		@cd $(BACKEND_DIR) && python3 -c "import apps.automations.sales_chart_messenger as m; assert m; print('✅ Sales Chart Messenger imports OK')"
		@cd $(BACKEND_DIR) && python3 -c "import libs.whatsapp_integration as w; assert w; print('✅ WhatsApp integration imports OK')"

sales-chart-messenger-clean:
	@cd $(BACKEND_DIR) && find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	@cd $(BACKEND_DIR) && find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	@cd $(BACKEND_DIR) && rm -rf .pytest_cache/ .mypy_cache/ htmlcov/ .coverage 2>/dev/null || true

sales-chart-messenger-diagnose:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode diagnose

sales-chart-messenger-run-bss-morning:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode run bss --period morning

sales-chart-messenger-run-bss-evening:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode run bss --period evening

sales-chart-messenger-run-nh-morning:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode run nh --period morning

sales-chart-messenger-run-nh-evening:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode run nh --period evening

sales-chart-messenger-test-bss-morning:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode test bss --period morning

sales-chart-messenger-test-bss-evening:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode test bss --period evening

sales-chart-messenger-test-nh-morning:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode test nh --period morning

sales-chart-messenger-test-nh-evening:
	@cd $(BACKEND_DIR) && python3 -m apps.automations.sales_chart_messenger --mode test nh --period evening
