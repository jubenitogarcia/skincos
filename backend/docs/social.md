# Redes Sociais (Social Publisher)

Este documento cobre o módulo “Redes Sociais” (Instagram/Facebook/Threads) do CRM.

## Arquitetura (visão rápida)
- **UI (CRM)**: `frontend/SocialNetworksStudio.tsx`
- **API (Pages Functions)**: `frontend/functions/api/social/*`
- **Storage**: R2 (`SHARE_BUCKET`) com fila, assets, resultados e auditoria
- **Worker cron**: `backend/apps/social-publisher` (publica via Meta Graph e grava resultados)

## Fluxos principais
1) **Enfileirar mídia**
   - `POST /api/social/queue/upload`
   - Valida sessão + CSRF, salva grupo + assets em R2 e expõe URLs públicas via `/social-media/:assetId`.
2) **Publicar (job)**
   - `POST /api/social/publish` → cria job em `social/jobs/*` + `social/job-index/*` e retorna `jobId`.
   - Worker cron processa o job, publica no Meta Graph e grava resultados.
3) **Status de job**
   - `GET /api/social/job-status?jobId=...` → `pending | done | unknown`.
4) **Resultados**
   - `GET /api/social/results?dateKey=...&groupKey=...` → resultado por unidade/plataforma.

## Layout no R2 (prefixos)
> Observação: se `R2_KEY_PREFIX` estiver definido, **todos os caminhos abaixo** ficam sob esse prefixo.

- `social/queue/{dateKey}/{groupKey}/group.json`
- `social/queue/{dateKey}/{groupKey}/assets/*`
- `social/assets/{assetId}/meta.json`
- `social/assets/{assetId}/file`
- `social/jobs/{dateKey}/{groupKey}/{jobId}.json`
- `social/job-index/{jobId}.json`
- `social/job-results/{jobId}.json`
- `social/results/{dateKey}/{groupKey}/*`
- `social/published/{dateKey}/{groupKey}/{unitKey}/{platform}.json`
- `social/metrics/last_jobs_run.json`
- `internal/social/accounts/{unitKey}/{platform}.json`
- `internal/audit/social/{yyyy-mm-dd}/{eventId}.json`
- `internal/share/index/{yyyy-mm-dd}/*` (base para cleanup de shares)

## Autenticação admin
As rotas admin exigem usuário autenticado no Insumos e seguem a ordem:
1) **Role allowlist**: `SOCIAL_ADMIN_ROLE_ALLOWLIST` (roles separadas por vírgula).
2) **Email allowlist**: `SOCIAL_ADMIN_EMAIL_ALLOWLIST` (emails separados por vírgula).
3) **Token**: `SOCIAL_ADMIN_TOKEN` via header `x-social-admin-token`.

> Se `SOCIAL_ADMIN_ROLE_ALLOWLIST` estiver configurado e o usuário tiver uma role permitida, o token deixa de ser necessário.

## Variáveis de ambiente (CRM/Pages)
- `INTEGRATIONS_ENCRYPTION_SECRET` (recomendado)
- `REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true` (falha fechado se secret ausente)
- `R2_KEY_PREFIX` (recomendado para separar preview/prod)
- `SOCIAL_ADMIN_TOKEN` (fallback para admin)
- `SOCIAL_ADMIN_EMAIL_ALLOWLIST`
- `SOCIAL_ADMIN_ROLE_ALLOWLIST`
- `SOCIAL_MEDIA_MAX_AGE_DAYS` / `SHARE_MAX_AGE_DAYS`

## Variáveis de ambiente (Worker social-publisher)
- `SOCIAL_PUBLISHER_ENABLED=true`
- `SOCIAL_JOBS_ENABLED=true`
- `SOCIAL_JOBS_MAX_PER_RUN` (default 50)
- `SOCIAL_CLEANUP_ENABLED=true|false`
- `SOCIAL_RETENTION_DAYS` (default 45)
- `SOCIAL_CLEANUP_MAX_DATEKEYS_PER_RUN` (default 10)
- `SOCIAL_CLEANUP_MAX_ASSETS_PER_DATEKEY` (default 2000)
- `SHARE_CLEANUP_ENABLED=true|false`
- `SHARE_RETENTION_DAYS`
- `SHARE_CLEANUP_MAX_SHARES_PER_RUN`
- `INTEGRATIONS_ENCRYPTION_SECRET`
- `PUBLIC_ORIGIN`
- `SHARE_BUCKET`, `LOCK` (bindings)

## Checklist de deploy (Social)
- `INTEGRATIONS_ENCRYPTION_SECRET` configurado e `REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true`.
- `R2_KEY_PREFIX` definido para preview (ou `R2_PRODUCTION_BRANCH` correto) — preview não pode escrever em prod.
- `SOCIAL_PUBLISHER_ENABLED=true` e cron ativo no Worker.
- `SOCIAL_JOBS_ENABLED=true` (publish assíncrono).
- `SOCIAL_ADMIN_ROLE_ALLOWLIST` ou `SOCIAL_ADMIN_TOKEN` definidos.
- URLs públicas (`/social-media/*`, `/share/*`) acessíveis no domínio correto.

## Matriz de ambientes (mínimo recomendado)
- **Production**: `R2_KEY_PREFIX` vazio, `SOCIAL_PUBLISHER_ENABLED=true`, `SOCIAL_CLEANUP_ENABLED=true`.
- **Preview**: `R2_KEY_PREFIX=preview/<branch>/`, `SOCIAL_PUBLISHER_ENABLED=false` (evita publicar real), `SOCIAL_JOBS_ENABLED=true` se quiser testar fila/worker.

## Runbook (diagnóstico rápido)
- **“FORBIDDEN”** em admin:
  - Verifique `SOCIAL_ADMIN_ROLE_ALLOWLIST` e `SOCIAL_ADMIN_EMAIL_ALLOWLIST`.
  - Se não usar allowlist, inclua `x-social-admin-token` válido.
- **“SOCIAL_ADMIN_TOKEN_NOT_CONFIGURED”**:
  - Configure `SOCIAL_ADMIN_TOKEN` ou adote `SOCIAL_ADMIN_ROLE_ALLOWLIST`.
- **Job pendente sem resultado**:
  - Confirme `SOCIAL_PUBLISHER_ENABLED=true` e cron ativo no Worker.
  - Consulte logs do Worker (wrangler tail / Cloudflare logs).
- **Mídia 404**:
  - Verifique `R2_KEY_PREFIX` e `SOCIAL_MEDIA_MAX_AGE_DAYS`.
- **UNAUTHORIZED**:
  - Sessão do Insumos expirada ou ausente (login necessário).
