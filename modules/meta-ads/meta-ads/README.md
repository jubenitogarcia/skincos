# Meta Ads (subprojeto)

Este modulo e um subprojeto isolado que futuramente sera integrado ao CRM do `skincos`.

## Setup rapido
1. Copie os envs (use o template):

```
cp ../../config/templates/modules/meta-ads/.env.example ./apps/api/.env
cp ../../config/templates/modules/meta-ads/.env.example ./apps/worker/.env
```

2. Ajuste `DATABASE_URL`, `REDIS_URL` e `ENCRYPTION_MASTER_KEY`.

3. Suba o banco/redis (separado do CRM):

```
docker compose up -d
```

4. Migre e rode:

```
pnpm prisma migrate dev
pnpm --filter @meta/db seed
./../../scripts/meta-ads.sh start
```

## Endpoints
- Health: `http://localhost:4000/api/health`
- OAuth: `http://localhost:4000/api/meta/oauth/*`
- Bulk ops: `/api/bulk/*`

## UI no CRM
A interface esta no frontend do CRM (`skincos/frontend`) no modulo **Meta Ads**.
O CRM faz proxy para o Meta Ads via `/api/meta-ads/*`.
Se precisar apontar direto para outro host, use `VITE_META_ADS_API_URL`.

## Observacao
- O app usa Postgres e Redis isolados.
- `apps/web` (Next.js) permanece apenas como referencia e nao e usado no CRM.

## Ingestao Cloudflare para Performance Report

O pipeline `Meta Ads - Performance Report` do n8n persiste no Cloudflare via Worker dedicado:

- app: `C:/CodexShared/Projetos/skincos/backend/apps/meta-ads/apps/report-ingest-worker`
- Worker: `skincos-meta-ads-performance-report`
- staging: `skincos-meta-ads-performance-report-staging`

Infra usada:

- D1 principal para `entities`, `metric_snapshots`, `ingestion_audit`, `metric_duplication_audit`, `ingestion_runs`
- R2 para payload bruto da Meta Graph API

Operacoes principais:

```bash
cd C:/CodexShared/Projetos/skincos/backend/apps/meta-ads/apps/report-ingest-worker
wrangler d1 migrations apply skincos-meta-ads-performance-report --remote
wrangler d1 migrations apply skincos-meta-ads-performance-report-staging --remote --env staging
wrangler deploy
wrangler deploy --env staging
```

Contrato HTTP:

- `POST /ingest/meta-ads-performance-report`
- auth default: `Authorization: Bearer <WORKER_API_TOKEN>`
- health: `GET /health`
- contrato: `GET /contract/meta-ads-performance-report`
