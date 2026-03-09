# skincos

Plataforma interna (local) para automações e operações da clínica.

## Estrutura (source of truth)
- Backend: `backend/` (apps, automations, libs, tools, scripts)
- Frontend (CRM/UI): `frontend/`
  - Meta Ads (migrado): API em `backend/apps/meta-ads` e modulo UI no CRM

## Como rodar (local)
- Stack principal (recomendado): `./backend/scripts/dev.sh watch`
- CRM (frontend + API): `./frontend/restart_crm.sh --watch-full`
- macOS (sem terminal): dê duplo clique em `start-platform.command`
 - Meta Ads (API + worker): `./backend/scripts/meta-ads.sh start`

### Auth local (sem login manual)
- Em `localhost`, o frontend ativa bypass de auth por padrão para testes (`/api/auth/me` e `/api/insumos/auth/me` retornam usuário dev).
- Para desligar bypass no frontend local: `VITE_LOCAL_AUTH_BYPASS=false npm run dev`.
- Overrides úteis (frontend local): `VITE_LOCAL_AUTH_ROLE`, `VITE_LOCAL_AUTH_EMAIL`, `VITE_LOCAL_AUTH_NAME`.
- Em Pages Functions local (`npm run dev:pages`), o bypass também é ativo para `requireCrmUser` em `localhost`.
- No CRM API local (`backend/apps/crm-api/server.js`), o stub de sessão dev fica ativo por padrão fora de produção; para exigir login real localmente, rode com `NO_AUTH=false`.
- Escala em local (`npm run dev`, `./frontend/restart_crm.sh` e `npm run dev:pages`): padrão em `frontend/.dev.vars` é leitura de dados reais (`LOCAL_ESCALA_MOCK=false`, `ESCALA_API_TARGET=https://escala-api.skincos.com.br`) com escrita sombra local (`LOCAL_ESCALA_SHADOW_WRITES=true`).
- Efeito da escrita sombra: o CRM local confirma CRUD e reflete as mudanças localmente, mas **não grava no banco online**.
- Para isso, configure `ESCALA_ACTOR_HMAC_KEY` real em `frontend/.dev.vars`; sem essa chave, as leituras reais da Escala retornam erro de autenticação.
- A sombra local da Escala agora persiste entre reinícios em `frontend/.local/escala-shadow.json` (ignorado pelo git). Para desligar isso: `LOCAL_ESCALA_SHADOW_PERSIST=false`.
- Diagnóstico local da Escala:
  - `GET /api/escala/_proxy-status` mostra se o modo ativo é `local-mock`, `upstream` ou `upstream+local-shadow`.
  - `GET /api/escala/_local-shadow` lista as operações locais persistidas.
  - `DELETE /api/escala/_local-shadow` limpa a sombra local e força o CRM a voltar ao estado puro do upstream.

## Módulo Ponto (face + PIN)
- Backend (CRM API): expõe endpoints em `/api/ponto/*` e persiste em `backend/var/core/` (ignorado do git).
- Config (env): `PONTO_ADMIN_TOKEN` (rotas admin) e `PONTO_ACTOR_HMAC_KEY` (assinatura do actor para rotas `/me/*` via Pages proxy).
- Config (env, opcional): `PONTO_TEMPLATES_KEY` (AES-256-GCM p/ templates faciais em repouso), `PONTO_AUDIT_HMAC_KEY` (HMAC da trilha de auditoria), `PONTO_FACE_THRESHOLD`, `PONTO_PUNCH_COOLDOWN_SECONDS`.
- Frontend: baixe os modelos faciais para `frontend/public/face-models/` com `cd frontend && npm run fetch-face-models`.
- Fluxo recomendado: Admin cadastra funcionário (email + PIN + unidade) e opcional biometria → Funcionário bate ponto direto no CRM (Face → PIN) → Admin exporta e audita. Dispositivos são opcionais via “Gerenciar Dispositivo”.

## Redes Sociais (Instagram/Facebook/Threads)
- Config (env, recomendado): `INTEGRATIONS_ENCRYPTION_SECRET` (AES-GCM p/ tokens em repouso no R2).
- Config (env, recomendado): `REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true` (falha fechado se o secret não estiver configurado).
- Config (env, recomendado): `R2_KEY_PREFIX` (ex: `preview/`) para isolar dados de R2 entre ambientes (preview ≠ production).
- Config (env, opcional): `SOCIAL_MEDIA_MAX_AGE_DAYS` e `SHARE_MAX_AGE_DAYS` (se definidos, links públicos antigos passam a retornar 404).
- Config (env, opcional): `SOCIAL_ADMIN_EMAIL_ALLOWLIST` (lista de emails, separados por vírgula, exigidos para ações de admin Social).
- Config (env, opcional): `SOCIAL_ADMIN_ROLE_ALLOWLIST` (lista de roles, separados por vírgula, permitindo admin Social sem token).
- Publicação manual agora **enfileira job** em `social/jobs/*` e o Worker `social-publisher` processa (habilite `SOCIAL_JOBS_ENABLED=true`).
- Endpoint de status de job: `GET /api/social/job-status?jobId=...` (retorna `pending|done|unknown`).

### Dev local (Social via Pages Functions)
- Recomendado: `cd frontend && npm run dev:pages` (sobe Vite + Pages Functions com bindings locais).
- Acesse `http://localhost:8788` (Pages) — a UI usa Functions reais (`/api/social/*`, `/social-media/*`).
- Se precisar de variáveis locais, crie `frontend/.dev.vars` (ignorado) com, por exemplo:
  - `SOCIAL_ADMIN_TOKEN=...`
  - `INTEGRATIONS_ENCRYPTION_SECRET=...`
  - `REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true`

## Docs
- Mapa do backend: `backend/docs/INDEX.md`
- Política de lockfiles: `backend/docs/LOCKFILES.md`
- Segredos e rotação: `docs/secrets-rotation.md`
- Observabilidade/SLOs: `docs/observability.md`
- Workflow de criativos WhatsApp (prompt system): `backend/docs/modules/crm/whatsapp-creative-workflow.md`

## CRM (banner de demo)
- `VITE_DEMO_DATA=false` para ocultar o aviso de dados simulados quando tudo estiver integrado.

## Sanity check
- Suite rápida (recomendado): `./backend/scripts/doctor.sh`
