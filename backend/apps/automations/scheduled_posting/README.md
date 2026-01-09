# Scheduled Posting (backend/apps/automations/scheduled_posting)

Automação Python para publicação agendada (Instagram) com monitoramento/diagnósticos.

## Start
- Runner: `./backend/apps/automations/scheduled_posting/scripts/run.sh`
- Via orquestrador: `./backend/scripts/dev.sh scheduled-posting`

## Config / Paths
- Helpers (Python): `backend/libs/scheduler_config.py`
- Arquivo config local (ignorado): `backend/var/scheduled_posting/config.json`
  - Override: `SCHEDULED_POSTING_CONFIG=/caminho/config.json`

## Estado local
- Diretório base: `backend/var/scheduled_posting/`
