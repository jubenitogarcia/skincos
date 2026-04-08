# Report Ingest Worker

Worker Cloudflare responsável por receber o payload do workflow `Meta Ads - Performance Report` no n8n e persistir em D1/R2.

Também expõe um endpoint de inventário incremental para o workflow reaproveitar ads já persistidos e evitar redescobrir `campaigns -> adsets -> ads` em toda execução.

## Endpoints

- `GET /health`
- `GET /contract/meta-ads-performance-report`
- `GET /inventory/meta-ads-performance-report?account_id=...&freshness_hours=...&limit=...`
- `POST /ingest/meta-ads-performance-report`

## Bindings

- `META_ADS_DB`
- `META_ADS_RAW_PAYLOADS`

## Vars

- `ENVIRONMENT`
- `LOG_LEVEL`
- `REQUIRE_AUTH`
- `WORKER_AUTH_HEADER_NAME`
- `WORKER_AUTH_SCHEME`

## Secrets

- `WORKER_API_TOKEN`

## Deploy

```bash
wrangler d1 migrations apply skincos-meta-ads-performance-report --remote
wrangler d1 migrations apply skincos-meta-ads-performance-report-staging --remote --env staging
wrangler secret put WORKER_API_TOKEN
wrangler secret put WORKER_API_TOKEN --env staging
wrangler deploy
wrangler deploy --env staging
```

## Contrato

Inventário:

- método `GET`
- autenticação bearer idêntica ao endpoint de ingestão
- query `account_id` obrigatória
- query `freshness_hours` opcional
- query `limit` opcional
- resposta com `count` + `items`

Headers:

- `Content-Type: application/json`
- `Idempotency-Key`
- `Authorization: Bearer <WORKER_API_TOKEN>`

Body obrigatório:

- `run`
- `entities`
- `metric_snapshots`
- `ingestion_audit`
- `raw_payloads`

Body opcional:

- `compatibility_exports`
- `duplication_report`

## Idempotência e fases

- O Worker usa `Idempotency-Key` como chave primária de reconciliação em `ingestion_runs`.
- Se receber novamente um payload já concluído com a mesma chave, responde `200` com `idempotentReplay: true`.
- Se receber a mesma chave enquanto uma ingestão ainda está em andamento e a tentativa anterior não está stale, responde `202` com `inProgress: true`.
- O progresso operacional fica explícito em `ingestion_runs`:
  - `phase`
  - `last_successful_phase`
  - `attempt_count`
  - `last_request_id`
  - `r2_status`
  - `d1_status`
  - `processing_warnings_json`

## Resiliência

- O upload de payload bruto para R2 ocorre antes do commit dos índices em D1.
- As escritas em D1 seguem fases explícitas para `entities`, `metric_snapshots`, `ingestion_audit`, `metric_duplication_audit` e `raw_payloads`.
- Em falha parcial, uma nova tentativa com a mesma `Idempotency-Key` reconcilia o estado usando `upsert`, sem duplicar a camada analítica principal.
