# Catálogo de Módulos (skincos)

Este catálogo descreve “o que é o quê” dentro do workspace e como iniciar cada módulo.

Entrada rápida: `backend/docs/INDEX.md`.

Ferramentas do workspace:
- Status: `./backend/scripts/status.sh`
- Limpeza (artefatos locais): `./backend/scripts/clean-local-artifacts.sh --dry-run` (ou `--apply`)
- Catálogo core/capabilities: `backend/capabilities.json`

## Core (stack principal)

- `frontend/` + `backend/apps/crm-api/` — CRM (frontend Vite + backend Express).
  - Start: `./frontend/restart_crm.sh --watch-full --crm-port 5173 --crm-api-port 8099`
  - Via wrapper: `./backend/scripts/dev.sh restart`

- `backend/apps/whatsapp/official-module/` — WhatsApp Official Module (porta 3001 por padrão).
  - Start: `./backend/scripts/dev.sh official --instance 1` (alias: `./backend/scripts/dev-official-watch.sh --instance 1`)

- `backend/apps/whatsapp/gateway/` — WhatsApp Gateway legado / APIs auxiliares.
  - Start: `./backend/scripts/dev.sh gateway --instance 1` (alias: `./backend/scripts/dev-gateway-watch.sh --instance 1`)

- `backend/apps/agent-zero/` — Agent Zero (UI e automações).
  - Start: `./backend/scripts/dev.sh agent start`
  - UI/API integrada: `backend/apps/agent-zero/integrated/`
  - Também sobe automaticamente no `./backend/scripts/dev.sh restart` / `watch` (quando presente).

- Sales Chart Messenger — automação Python em `backend/apps/automations/sales_chart_messenger/`.
  - Start: `./backend/scripts/dev.sh sales-chart-messenger`

## Automations

- `backend/apps/automations/scraper/` — Automação Espaço Facial (Python).
  - Start: `./backend/scripts/dev.sh scraper all`
  - Config: `backend/apps/automations/scraper/config.local.json` (ignorado) a partir de `backend/config/templates/modules/scraper/config.example.json`

- `backend/apps/automations/sprinta/legacy/` — Sprinta (Selenium + Webhook/Wix).
  - Start: `./backend/scripts/dev.sh sprinta legacy <csv> [args]`

- `backend/apps/automations/sprinta/v2/` — Sprinta v2 (python `-m src`).
  - Start: `./backend/scripts/dev.sh sprinta v2 --csv data/participantes.csv --headless`

## Apps adicionais

- `backend/apps/actual-server/` — Actual Budget sync server (porta default 5006).
  - Start: `./backend/scripts/dev.sh actual-server start`
  - Menu: `./backend/scripts/dev.sh actual-server menu`
  - Também sobe automaticamente no `./backend/scripts/dev.sh restart` / `watch` (quando presente).

- `backend/apps/whatsapp/chat-module/` — Chat Module (pacotes: `@chat-module/whatsapp-core`, `@chat-module/whatsapp-api`, `@chat-module/whatsapp-ui`).
  - Observação: é uma cópia “in-tree” do módulo (opcional).

## Instagram

- `backend/apps/instagram/instagrapi/` — biblioteca e ambiente docker (mkdocs via compose na porta 8000).
  - Compose: `docker compose up mkdocs` (dentro de `backend/apps/instagram/instagrapi/`)

- `backend/apps/instagram/module/` — API Node + módulo Python (OSINT/automação/download).
  - API Node: `./backend/scripts/dev.sh instagram-module start` (porta env `INSTAGRAM_PORT`, default 3103)
  - Config: `backend/apps/instagram/module/config/config.local.json` (ignorado) a partir de `backend/config/templates/modules/instagram-module/config.example.json` ou via `INSTAGRAM_CONFIG=/caminho/arquivo.json`
  - Também sobe automaticamente no `./backend/scripts/dev.sh restart` / `watch` (quando presente).

## Archive / Backup

- `backend/tools/scripts/xiaomi/` — utilitário para extração de token (histórico).
  - Start: `./backend/scripts/dev.sh xiaomi-token`

- `backend/var/browser-profiles/` — perfis de navegador / dados locais (não-código; manter ignorado no git).
