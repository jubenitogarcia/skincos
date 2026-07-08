SHELL := /bin/bash

.PHONY: dev backend-dev backend-status backend-health backend-compile backend-unit website-install website-dev website-build website-typecheck website-deploy

dev: backend-dev

backend-dev:
	@make -C backend dev

backend-status:
	@bash ./backend/scripts/status.sh

backend-health:
	@bash ./backend/scripts/test.sh repo-health

backend-compile:
	@bash ./backend/scripts/test.sh compile

backend-unit:
	@bash ./backend/scripts/test.sh unit

website-install:
	@npm --prefix modules/site-public/website ci

website-dev:
	@npm --prefix modules/site-public/website run dev

website-build:
	@npm --prefix modules/site-public/website run build

website-typecheck:
	@npm --prefix modules/site-public/website run build && npm --prefix modules/site-public/website run typecheck

website-deploy:
	@npm --prefix modules/site-public/website run deploy
