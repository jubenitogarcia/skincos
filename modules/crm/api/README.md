# CRM API (backend/apps/crm-api)

API Node/Express usada pelo frontend CRM e pelo “unified WhatsApp orchestrator” do monorepo.

## Start
- Simples: `node backend/apps/crm-api/server.js`
- Via orquestrador: `./backend/scripts/dev.sh crm`

## Portas / Health
- Default: `8099` (`CRM_API_PORT` ou `PORT`)
- Health: `GET /health` e `GET /api/health`

## Harmonia (Decision API)
Rotas: `/api/harmonia/*`

- Auth (opcional, recomendado p/ ambientes com acesso compartilhado):
  - `HARMONIA_DEBUG_TOKEN=...`
  - Envie o token em `X-Harmonia-Token: ...` (ou query `?token=...`) nas rotas de leitura/debug (units, conversas, stats, cleanup).
  - Execucao (tarefas/delivery): `HARMONIA_EXEC_TOKEN=...`
    - Header: `X-Harmonia-Exec-Token: ...` (ou query `?exec_token=...`)
  - Ingest (entrada normalizada): `HARMONIA_INGEST_TOKEN=...`
    - Header: `X-Harmonia-Ingest-Token: ...` (ou query `?ingest_token=...`)

- Health: `GET /api/harmonia/health`
- Ingest (payload normalizado): `POST /api/harmonia/ingest`
- Webhook (WhatsApp Official Module): `POST /api/harmonia/webhook/official`
- Webhook (Evolution/Gateway): `POST /api/harmonia/webhook/evolution`
- Delivery callback (executor/worker → Harmonia): `POST /api/harmonia/delivery`
- Tasks (cron/executor):
  - Claim: `POST /api/harmonia/tasks/claim`
  - Complete: `POST /api/harmonia/tasks/complete`
  - Tipos: `SEND_MESSAGE`, `NOTIFY_INTERNAL`, `FOLLOW_UP`
  - Stats: `GET /api/harmonia/tasks/stats`
- Maintenance:
  - Cleanup (tasks/delivery/messages): `POST /api/harmonia/maintenance/cleanup` (params: `tasksDays`, `deliveryDays`, `messagesDays`)
- Units config (read-only): `GET /api/harmonia/units` e `GET /api/harmonia/units/:slug`
- Conversas (debug):
  - Inbox por unidade (ordenado por atividade): `GET /api/harmonia/conversations?unitSlug=...&limit=30&cursorTs=...&cursorId=...`
  - Find by unit/phone: `GET /api/harmonia/conversations/find?unitSlug=...&phoneRaw=...`
  - By id: `GET /api/harmonia/conversations/:id`
  - Messages: `GET /api/harmonia/conversations/:id/messages?limit=50`

### Env vars (Harmonia)
- `DATABASE_URL` (obrigatório para persistência)
- `HARMONIA_AUTO_MIGRATE=1` (opcional, cria schema/tabelas e seed de unidades)
- `HARMONIA_STORE_RAW=1` (opcional, persiste payload completo no `messages.raw` com redaction)
- `HARMONIA_DEBUG_TOKEN` (opcional, protege rotas de leitura/debug)
- `HARMONIA_EXEC_TOKEN` (opcional, protege rotas de execucao: tasks/delivery)
- `HARMONIA_INGEST_TOKEN` (opcional, protege `POST /api/harmonia/ingest`)
- `HARMONIA_RATE_LIMIT_SECONDS` (default: `20`)
- `HARMONIA_TASKS_CLAIM_LIMIT` (default: `20`)
- `HARMONIA_TASKS_STALE_MINUTES` (default: `30`)
- `HARMONIA_TASKS_MAX_ATTEMPTS` (default: `5`)
- `HARMONIA_TASKS_BACKOFF_SECONDS` (default: `30`)
- `HARMONIA_TASKS_BACKOFF_MAX_SECONDS` (default: `900`)
- `HARMONIA_TASKS_ALERT_NOTIFY=1` (opcional, cria alerta interno após falha final)
- `HARMONIA_AUTO_EXECUTE=1` (opcional, cria tasks a partir das `actions`)
- `HARMONIA_WORKER=1` (opcional, ativa worker interno de envio)
- `HARMONIA_DEFAULT_UNIT_SLUG` (default: `novo_hamburgo`)
- `HARMONIA_OFFICIAL_INSTANCE_NAME` (default: `WhatsApp Official`)
- `HARMONIA_CTA_DEFAULT` (default: `hoje`)
- `HARMONIA_TAG_MAP` (JSON opcional, override de tag → procedure_code)
- `HARMONIA_NOTIFY_MAP` (JSON opcional, `{"novo_hamburgo":"55...","barra_shopping":"55...","default":"55..."}`)
- `HARMONIA_ATTENDANTS` (JSON opcional, `{"novo_hamburgo":{"morning":"Evelin","afternoon":"Cauane"}}`)
- `HARMONIA_WEBHOOK_SECRET` (opcional, valida `X-Signature` nos webhooks oficiais)
- `HARMONIA_CHANNEL_MAP` (JSON opcional, `{"1":"novo_hamburgo","2":"barra_shopping"}`)
- WhatsApp Provider:
  - `HARMONIA_WA_PROVIDER` (`official` ou `gateway`)
  - `HARMONIA_WA_BASE_URL` (default: `http://localhost:3001`)
  - `HARMONIA_WA_CHANNEL_DEFAULT` (default: `1`)
  - `HARMONIA_WA_CHANNEL_NH` (opcional)
  - `HARMONIA_WA_CHANNEL_BSS` (opcional)
  - Orquestrador Evolution (opcional):
    - `WA_ORCHESTRATOR_PROVIDER=evolution`
    - `EVOLUTION_API_URL` (ex.: `http://localhost:8080`)
    - `EVOLUTION_API_KEY`
    - `EVOLUTION_INSTANCE_PREFIX` (default: `crm-channel-`)
- Google Sheets:
  - `HARMONIA_GOOGLE_SHEETS_DOC_ID`
  - `HARMONIA_GOOGLE_SHEETS_GID` (ou `HARMONIA_GOOGLE_SHEETS_TAB_NAME`)
  - `HARMONIA_GOOGLE_SA_FILE` (default: `$VAR_DIR/secrets/google-sa.json`)
- OpenAI (opcional):
  - `OPENAI_API_KEY`
  - `HARMONIA_OPENAI_MODEL` (default: `gpt-5-nano`)

## Estado local / logs
- Preferir `backend/var/` via `VAR_DIR` (quando executado pelos scripts do monorepo).

## Atendimento
Rotas: `/api/atendimento/*`

- Persistência: PostgreSQL em `DATABASE_URL`.
- Segurança Pages → API: `ATENDIMENTO_ACTOR_HMAC_KEY` deve ser igual no Pages Function e no `crm-api`; quando essa secret não existe, o código cai para `ESCALA_ACTOR_HMAC_KEY`/`CRM_ESCALA_HMAC_KEY` como fallback compartilhado.
- Importação inicial Google Sheets:
  - `ATENDIMENTO_GOOGLE_SHEET_ID` (default: planilha histórica do acompanhamento)
  - `ATENDIMENTO_GOOGLE_SA_FILE` (ou `HARMONIA_GOOGLE_SA_FILE`)
  - Dry-run: `npm run import-atendimento-sheet`
  - Gravação: `npm run import-atendimento-sheet -- --write`
- Módulo CRM: `atendimento`; gestores/gerentes acessam tudo, usuários comuns precisam do módulo liberado e respeitam `allowedUnits`.
