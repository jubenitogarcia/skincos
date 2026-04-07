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
- `POST /api/escala/professionals`
- `PUT /api/escala/professionals`
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

## Invariantes do módulo
- `Equipe` vem de `professionals` por unidade; não depende do mês ter escala montada.
- `schedule_entries` complementa a agenda do mês, mas não substitui o cadastro de equipe.
- Falha em `professionals` deve aparecer como erro operacional, nunca como “equipe vazia”.
- Toda mudança de schema da Escala precisa passar por migration aplicada antes do deploy.

## Smoke funcional
Smoke autenticado do worker:
```
ESCALA_ACTOR_HMAC_KEY=... node ./scripts/smoke.mjs
```

Variáveis opcionais:
- `ESCALA_SMOKE_BASE_URL` (`https://escala-api.skincos.com.br` por padrão)
- `ESCALA_SMOKE_UNIT`
- `ESCALA_SMOKE_MONTH`

O smoke valida:
- `GET /api/escala/overview`
- `GET /api/escala/professionals?unit=...`
- `GET /api/escala/schedule?unit=...&month=...`

## Runbook curto
### Sintoma: Equipe vazia em mês sem escala
1. Rodar o smoke funcional do worker.
2. Verificar se `GET /api/escala/professionals` retorna `200` e payload válido.
3. Verificar migrations remotas:
   - `wrangler d1 migrations apply skincos-escala --remote`
4. Se o worker estiver saudável e `professionals` falhar, revisar schema drift e logs `escala.error`.

### Sintoma: erro de autenticação
1. Verificar se `ESCALA_ACTOR_HMAC_KEY` está sincronizada no Pages proxy e no worker.
2. Validar timestamp/assinatura via smoke.
3. Revisar respostas `401 UNAUTHORIZED` e `403 FORBIDDEN` nos logs do worker.
