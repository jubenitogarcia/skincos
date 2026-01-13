# Deploy (skincos)

Este repo não “se auto-deploya” sozinho: isso depende de integrações (Cloudflare Pages/Workers) ou de um servidor (VPS) consumindo o código.

## Frontend (CRM) → `crm.skincos.com.br`

Opção A (recomendado): **Cloudflare Pages** conectado ao GitHub.

- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Output directory: `dist`

### `/api/*` no domínio do Pages (backend mínimo)

Para o CRM conseguir chamar `/api/*` em produção (sem precisar de um Node server), usamos **Pages Functions**:

- Proxy Insumos: `frontend/functions/api/insumos/[[path]].ts`
- Health: `frontend/functions/api/health.ts`
- Rotas: `frontend/public/_routes.json` (inclui apenas `/api/health` e `/api/insumos/*`)

Obs: o deploy do Pages (incluindo `functions/`) acontece automaticamente via integração Git↔Cloudflare Pages.

## Backend (Insumos) → `api.skincos.com.br/insumos/*`

É um **Cloudflare Worker** em `backend/apps/insumos`.

Workflow de deploy:
- `.github/workflows/deploy-insumos-worker.yml`

Requer:
- `secrets.CLOUDFLARE_API_TOKEN` (e opcionalmente `secrets.CLOUDFLARE_ACCOUNT_ID`)
- (opcional) `vars.INSUMOS_D1_DB_NAME` (default: `skincos-db`)

Importante: variáveis/segredos de produção devem estar no Dashboard (ou `wrangler secret put`) e o deploy usa `--keep-vars`:
- `SPREADSHEET_ID`, `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SESSION_SECRET`

## Backend (CRM API) → `/api/*`

O servidor local é `backend/apps/crm-api/server.js` (Express). Para produção, você precisa escolher **onde ele roda**:

- **VPS + Cloudflare Tunnel** (sem Docker): rodar Node + `systemd/pm2`, expor via `cloudflared`.
- **Outro hosting Node** (Railway/Render/etc) e configurar DNS/proxy no Cloudflare.

O repo hoje não inclui workflow de deploy do `crm-api` porque depende do provedor/infra escolhidos.
