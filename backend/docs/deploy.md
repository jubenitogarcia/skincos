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
- Rotas: `frontend/public/_routes.json`
  - Básicas: `/api/health`, `/api/auth/*`, `/api/insumos/*`
  - Opcionais (módulos): `/api/instagram/*`, `/api/instagram-module/*`, `/api/social/*`, `/api/share/*`, `/api/unit-monitor/*`, `/api/placeholder/*`
  - Pages Functions de UI: `/share/*`, `/social-media/*`

Obs:
- O deploy do Pages (incluindo `functions/`) pode acontecer automaticamente via integração Git↔Cloudflare Pages **ou**
- via GitHub Actions + `wrangler` (workflow `.github/workflows/deploy-crm-pages.yml`, requer `secrets.CLOUDFLARE_API_TOKEN`, `secrets.CLOUDFLARE_ACCOUNT_ID` e `vars.ENABLE_CRM_PAGES_DEPLOY=true`).
- Recomendação: configure o Pages com `path_includes=["frontend/**"]` para não rebuildar/redeployar quando só o backend mudar.

## Backend (Insumos) → `api.skincos.com.br/insumos/*`

É um **Cloudflare Worker** em `backend/apps/insumos`.

## Backend (API) → `api.skincos.com.br/*`

É um **Cloudflare Worker** em `backend/apps/api` (implementação compartilhada com `apps/insumos`).

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

Workflow de deploy (opcional):
- `.github/workflows/deploy-crm-api.yml`

Requer:
- `vars.ENABLE_CRM_API_DEPLOY=true`
- `vars.CRM_API_DEPLOY_MODE` (`ssh` ou `http_restart`; default `ssh`)

Modo `ssh`:
- `secrets.CRM_API_SSH_HOST`
- `secrets.CRM_API_SSH_USER`
- `secrets.CRM_API_SSH_KEY`
- (opcional) `secrets.CRM_API_SSH_PORT`
- `vars.CRM_API_APP_DIR` (diretório do repo no servidor)
- `vars.CRM_API_DEPLOY_COMMAND` (ex.: `pm2 reload crm-api` ou `systemctl restart crm-api`)

Modo `http_restart`:
- `vars.CRM_API_RESTART_URL` (ex.: `https://cs-api.skincos.com.br/api/wa-orchestrator/local/recovery/restart`)
- `secrets.CRM_API_BASIC_AUTH` (valor `user:password`; o workflow envia em `Authorization: Basic ...`)
- O workflow envia payload com:
  - `mode=stack`
  - `sha=<commit do deploy>`
  - `syncRepo=true` (sincroniza repo local antes do restart)
  - `syncSha=<commit do deploy>` (alvo do `git reset --hard`)
  - `syncAutoStash=false` (não faz stash automático por padrão)
  - Se precisar permitir auto-stash explicitamente, defina `WA_LOCAL_RECOVERY_SYNC_ALLOW_AUTOSTASH=true` no ambiente do CRM API.
