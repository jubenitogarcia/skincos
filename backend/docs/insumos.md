# Insumos (Cloudflare)

Este módulo incorpora o projeto "Insumos" no monorepo do SKINCOS, centralizando o backend em Cloudflare Workers.

## Entrypoint

- Worker: [backend/apps/insumos/workers/index.js](../apps/insumos/workers/index.js)
- Config (Wrangler): [backend/apps/insumos/wrangler.toml](../apps/insumos/wrangler.toml)
- Migrações D1: [backend/apps/insumos/migrations](../apps/insumos/migrations)

## Rotas públicas

Base: `https://api.skincos.com.br/insumos/*`

- Health: `GET /insumos/health`
- Auth: `POST /insumos/auth/login`, `POST /insumos/auth/logout`, `POST /insumos/auth/refresh`, `PUT /insumos/auth/profile`, `GET /insumos/auth/me`
- Insumos: `GET /insumos/insumos`, `POST /insumos/insumos`, `PUT /insumos/insumos/:registro`, etc.
- Movimentações: `GET /insumos/movimentacoes`
- Ajuste: `POST /insumos/insumos/ajuste`
- Relatórios: `GET /insumos/relatorios/estoque`, `GET /insumos/relatorios/movimentacoes`
- Backup: `GET /insumos/backup/status`, `POST /insumos/backup/trigger`, `GET /insumos/backup/list`, `POST /insumos/backup/restore`, `POST /insumos/backup/cleanup`

## Consumo no CRM

Para evitar CORS e manter o padrão same-origin do CRM, o backend do CRM expõe proxy:

- `GET/POST/... /api/insumos/*` → `https://api.skincos.com.br/insumos/*`

Variável opcional:

- `INSUMOS_API_TARGET` (default `https://api.skincos.com.br`)

## Desenvolvimento local

Preferir via scripts canônicos do monorepo:

- `./backend/scripts/dev.sh insumos dev`
- `./backend/scripts/dev.sh insumos migrate` (env opcional: `INSUMOS_D1_DB`)
- `./backend/scripts/dev.sh insumos deploy`

Observação: o deploy usa `--keep-vars` para não apagar variáveis configuradas no Dashboard.

Para usar o Worker local no CRM (proxy via CRM API), rode o Worker e aponte o target:

- `INSUMOS_API_TARGET=http://127.0.0.1:8787 ./backend/scripts/dev.sh crm`

Smoke test (sem segredos / sem Google):

- `./backend/scripts/insumos-smoke.sh http://127.0.0.1:8787`

## Segredos

- `GOOGLE_PRIVATE_KEY`: definir via `wrangler secret put`.

### Sheets em dev (local)

Por padrão, o endpoint `GET /insumos/health` pode mostrar `sheetsConfigured: false`.
Isso não é erro: só significa que o Worker está rodando sem a chave privada do Google (modo seguro, sem segredos).

Para habilitar integração com Google Sheets localmente:

- Copie o arquivo [backend/apps/insumos/.dev.vars.example](../apps/insumos/.dev.vars.example) para `backend/apps/insumos/.dev.vars`
- Preencha `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` e `GOOGLE_PRIVATE_KEY`

Depois reinicie:

- `./backend/scripts/dev.sh insumos dev`
