# SKINCOS AI
## AI Improvement Dashboard
[AI Improvement Dashboard](./docs/internal/ai-knowledge/index.html)

Monorepo contendo múltiplos módulos (CRM, WhatsApp, automações, agentes e utilitários).

## Entrypoints (recomendado)

- Stack dev unificada:
  - do repo root: `./backend/scripts/dev.sh restart` (ou `make -C backend dev`)
  - dentro de `backend/`: `./scripts/dev.sh restart` (ou `make dev`)
- Status/saúde: `./backend/scripts/status.sh` (ou `./scripts/status.sh` dentro de `backend/`)
- E2E smoke/health: `./backend/scripts/e2e.sh smoke` / `./backend/scripts/e2e.sh health`

Docs de organização:
- Catálogo de módulos: `docs/MODULES.md`
- Handbook (inventário/planos/portas): `docs/HANDBOOK.md`
Docs por módulo:
- Sales Chart Messenger: `docs/SALES_CHART_MESSENGER.md`
  - WhatsApp: `docs/modules/whatsapp/`
  - CRM: `docs/modules/crm/`
  - Agent Zero: `docs/modules/a0/`

Observação: `apps/instagram/instagrapi/` (lib) e `apps/instagram/module/` (serviço) vivem dentro do monorepo (sem submodules).

Observação: a automação de gráficos/vendas foi incorporada ao domínio WhatsApp. Entrypoints:
- `./scripts/dev.sh sales-chart-messenger` (recomendado)
- `bash ./apps/automations/sales_chart_messenger/scripts/run.sh [args]` ou `python3 -m apps.automations.sales_chart_messenger --mode diagnose`
