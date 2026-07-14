# Backend Index (skincos)

Este é o “mapa rápido” do `backend/`: o que existe, onde está e como executar.

## Estrutura (source of truth)
- Apps/serviços (Node): `backend/apps/*`
- Automações/jobs (Python/CLI): `backend/apps/automations/*`
- Bibliotecas compartilhadas: `backend/libs/*`
- Ferramentas (dev/ops/auditoria): `backend/tools/scripts/*`
- Orquestração (CLI do monorepo): `backend/scripts/*`
- Templates de config versionados: `backend/config/templates/*`
- Estado local (sempre ignorado): `backend/var/*`
- Histórico/arquivo: `backend/archive/*`

## Quick start (local)
- Subir stack principal (recomendado): `./backend/scripts/dev.sh watch`
- Subir CRM + WhatsApp (watch): `./backend/scripts/dev.sh watch` (alias: `./backend/scripts/dev-all-watch.sh`)
- Status/health (best-effort): `./backend/scripts/status.sh`

## Módulos principais (como rodar)
- CRM API (Node): `backend/apps/crm-api/`
  - Start: `node backend/apps/crm-api/server.js`
  - Health: `http://localhost:8099/health`
- WhatsApp Official (Node): `backend/apps/whatsapp/official-module/`
  - Dev/watch: `./backend/scripts/dev.sh official --instance 1`
  - Health: `http://localhost:3001/health` (instância 1)
- WhatsApp Gateway legacy (Node): `backend/apps/whatsapp/gateway/`
  - Dev/watch: `./backend/scripts/dev.sh gateway --instance 1`
  - Health: `http://localhost:3001/health` (instância 1)
- Sales Chart Messenger (Python): `backend/apps/automations/sales_chart_messenger/`
  - Runner: `./backend/apps/automations/sales_chart_messenger/scripts/run.sh`
  - CLI: `python3 -m apps.automations.sales_chart_messenger`
- Scraper (Python): `integration/ef/`
  - Runner: `./backend/scripts/dev.sh scraper all`
- Sprinta (Python): `backend/apps/automations/sprinta/`
  - Runner: `./backend/scripts/dev.sh sprinta legacy|v2 ...`
- Cloudflare Workers (produção): `api` e `inventory`
  - Deploy: `./backend/scripts/cloudflare-workers.sh deploy-all`

## Configuração (sem segredos no git)
- Templates: `backend/config/templates/modules/*`
- Config global local: `backend/config/workspace.local.env` (ignorado)
- Estado/dados locais: `backend/var/*` (ignorado)
- Symlinks canônicos (auto-fix): `./backend/scripts/symlinks.sh apply`

## Dependências Node (backend)
Ver `backend/docs/NODE_PACKAGE_MANAGEMENT.md`.

## Deploy (produção)
- Visão geral: `backend/docs/deploy.md`
- Mapa completo (Cloudflare + serviços): `backend/docs/DEPLOYMENT_MAP.md`

## Módulos (docs)
- Social (Redes Sociais): `backend/docs/social.md`
- Insumos: `backend/docs/insumos.md`

## Testes
- Unit tests (pytest): `python3 -m pytest backend/tests/unit`
- Scripts manuais (smoke, podem chamar APIs reais): `backend/tests/manual/*`
- Runner unificado: `./backend/scripts/test.sh unit|compile|repo-health`
- Sanity suite (recomendado antes de mudanças grandes): `./backend/scripts/doctor.sh`
