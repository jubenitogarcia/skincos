SHELL := /bin/bash

.PHONY: dev backend-dev backend-status backend-health backend-compile backend-unit

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

