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
- `POST /api/escala/schedule` (add)
- `PUT /api/escala/schedule` (replace day)
- `DELETE /api/escala/schedule` (remove)
- `POST /api/escala/closed-days`
- `DELETE /api/escala/closed-days`
- `POST /api/escala/holidays`
- `DELETE /api/escala/holidays`
- `GET /health`

## Vars
- `APP_ORIGIN` (CORS)
- `ESCALA_ACTOR_HMAC_KEY` (auth)

## Auth (CRM proxy)
Os endpoints `/api/escala/*` exigem headers assinados:
- `x-crm-user` (base64url JSON do ator)
- `x-crm-ts` (timestamp ms)
- `x-crm-signature` (HMAC SHA-256 de `${ts}.${payload}`)
