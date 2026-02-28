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
