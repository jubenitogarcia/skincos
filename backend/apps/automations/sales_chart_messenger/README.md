# Sales Chart Messenger (backend/apps/automations/sales_chart_messenger)

Automação Python: Google Sheets/Drive → geração/validação de gráficos → envio via WhatsApp.

## Start
- Runner: `./backend/apps/automations/sales_chart_messenger/scripts/run.sh --help`
- Via orquestrador: `./backend/scripts/dev.sh sales-chart-messenger`
- CLI: `python3 -m apps.automations.sales_chart_messenger --mode diagnose`

## Config
- Template: `backend/config/templates/modules/whatsapp-sales-charts/`
- Local: `backend/config.json` e `backend/.env` (ambos ignorados)
- Estado local: `backend/var/` (logs/cache/downloads)

Docs detalhados: `backend/docs/SALES_CHART_MESSENGER.md`.
