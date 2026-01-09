# CRM API (backend/apps/crm-api)

API Node/Express usada pelo frontend CRM e pelo “unified WhatsApp orchestrator” do monorepo.

## Start
- Simples: `node backend/apps/crm-api/server.js`
- Via orquestrador: `./backend/scripts/dev.sh crm`

## Portas / Health
- Default: `8099` (`CRM_API_PORT` ou `PORT`)
- Health: `GET /health` e `GET /api/health`

## Estado local / logs
- Preferir `backend/var/` via `VAR_DIR` (quando executado pelos scripts do monorepo).

