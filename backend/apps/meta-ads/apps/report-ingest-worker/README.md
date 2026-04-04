# Report Ingest Worker

Worker Cloudflare responsável por receber o payload do workflow `Meta Ads - Performance Report` no n8n e persistir em D1/R2.

## Endpoints

- `GET /health`
- `GET /contract/meta-ads-performance-report`
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
