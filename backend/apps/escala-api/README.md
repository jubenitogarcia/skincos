# Escala API (Cloudflare Worker)

Serviço de escala rodando em Cloudflare Workers com D1.

## Deploy
```
cd backend/apps/escala-api
npx wrangler deploy --env ""
```

## D1
- Banco: `skincos-escala`
- Migrações: `migrations-d1/`

Aplicar migrações:
```
wrangler d1 migrations apply skincos-escala --remote
```

Seed:
```
wrangler d1 execute skincos-escala --remote --file=seed/escala_seed.sql
```
Ou:
```
./scripts/seed-remote.sh          # produção
./scripts/seed-remote.sh staging  # staging
```

## Endpoints
- `GET /api/escala/overview`
- `GET /api/escala/professionals?unit=...`
- `GET /api/escala/schedule?unit=...&month=YYYY-MM`
- `GET /health`

## Vars
- `APP_ORIGIN` (CORS)
