# skincos

Plataforma interna (local) para automações e operações da clínica.

## Estrutura (source of truth)
- Backend: `backend/` (apps, automations, libs, tools, scripts)
- Frontend (CRM/UI): `frontend/`

## Como rodar (local)
- Stack principal (recomendado): `./backend/scripts/dev.sh watch`
- CRM (frontend + API): `./frontend/restart_crm.sh --watch-full`
- macOS (sem terminal): dê duplo clique em `start-platform.command`

## Módulo Ponto (face + PIN)
- Backend (CRM API): expõe endpoints em `/api/ponto/*` e persiste em `backend/var/core/` (ignorado do git).
- Config (env, obrigatório): `PONTO_ADMIN_TOKEN` (token master para rotas `/api/ponto/admin/*`).
- Config (env, opcional): `PONTO_TEMPLATES_KEY` (AES-256-GCM p/ templates faciais em repouso), `PONTO_AUDIT_HMAC_KEY` (HMAC da trilha de auditoria), `PONTO_FACE_THRESHOLD`, `PONTO_PUNCH_COOLDOWN_SECONDS`.
- Frontend: baixe os modelos faciais para `frontend/public/face-models/` com `cd frontend && npm run fetch-face-models`.
- Fluxo recomendado: Admin cria funcionários (PIN + cadastro facial) → Admin cria token do dispositivo por unidade → telefone da clínica usa aba “Ponto” em “Dispositivo (relógio)” com o token.

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

## CRM (banner de demo)
- `VITE_DEMO_DATA=false` para ocultar o aviso de dados simulados quando tudo estiver integrado.

## Sanity check
- Suite rápida (recomendado): `./backend/scripts/doctor.sh`
