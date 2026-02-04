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

## Setup guiado (CRM)
O Planner do módulo “Redes Sociais” possui um checklist de primeiro acesso que valida:
- login (sessão/cookies do CRM),
- permissão de admin (role global `ADMIN`),
- contas configuradas por unidade/plataforma,
- (opcional) métricas do Worker.

Endpoints usados pelo checklist:
- `GET /api/social/setup/status` (retorna status de R2/prefix, criptografia, admin global e defaults)
- `GET /api/social/metrics/last-jobs-run` (lê `social/metrics/last_jobs_run.json` no R2)

## Bloqueio de abas por onboarding (Planner obrigatório)
Por padrão, as abas **Instagram/Facebook/Threads** ficam **visíveis porém bloqueadas** até o usuário finalizar o Planner.

Critério de liberação (para o escopo selecionado no Planner):
- Login no CRM OK (`/api/social/setup/status` não pode retornar 401)
- R2 configurado (`setup.r2.bucketConfigured === true`)
- Se criptografia for obrigatória, secret configurado (`setup.encryption.required === true` ⇒ `setup.encryption.configured === true`)
- Permissão de Admin OK (`setup.admin.isAdmin === true`)
- Contas configuradas para todas combinações `(unidade × plataforma)` do escopo (sem `missingAccounts`)

Preferências/persistência no browser (localStorage):
- `social.onboarding.scopeUnits` (CSV, ex.: `BSS,NH`)
- `social.onboarding.scopePlatforms` (CSV, ex.: `instagram,facebook,threads`)
- `social.onboarding.completed` (`"true"` quando o usuário clica “Finalizar e liberar abas”)
- `social.onboarding.completedAt` (ISO timestamp)

Reset (re-onboarding):
- Limpar os itens acima do `localStorage` (ou “Limpar dados do site” no browser).

## Unidades (personalização)
O módulo Social usa chaves curtas de unidade (hoje: `BSS` e `NH`). Para personalização, a UI tenta mapear unidades vindas da sessão do CRM:
- `barra-shopping-sul` → `BSS`
- `novo-hamburgo` → `NH`

Preferências locais no browser:
- `social.unitKey` (unidade padrão no Planner)
- `social.onlyMyUnit` (filtro da fila)

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

## Admin (global)
As rotas de admin do módulo Social (`/api/social/admin/*` e `/api/social/publish`) exigem usuário autenticado no CRM com role global `ADMIN`, `GESTOR` ou `GERENTE`.

## Variáveis de ambiente (CRM/Pages)
- `INTEGRATIONS_ENCRYPTION_SECRET` (recomendado)
- `REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true` (falha fechado se secret ausente)
- `R2_KEY_PREFIX` (recomendado para separar preview/prod)
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
- Usuários `ADMIN` do CRM conseguem configurar contas e publicar.
- URLs públicas (`/social-media/*`, `/share/*`) acessíveis no domínio correto.

## Matriz de ambientes (mínimo recomendado)
- **Production**: `R2_KEY_PREFIX` vazio, `SOCIAL_PUBLISHER_ENABLED=true`, `SOCIAL_CLEANUP_ENABLED=true`.
- **Preview**: `R2_KEY_PREFIX=preview/<branch>/`, `SOCIAL_PUBLISHER_ENABLED=false` (evita publicar real), `SOCIAL_JOBS_ENABLED=true` se quiser testar fila/worker.

## Runbook (diagnóstico rápido)
- **“ADMIN_REQUIRED”** em rotas admin:
  - Confirme que o usuário logado no CRM tem role global `ADMIN`, `GESTOR` ou `GERENTE`.
- **Job pendente sem resultado**:
  - Confirme `SOCIAL_PUBLISHER_ENABLED=true` e cron ativo no Worker.
  - Consulte logs do Worker (wrangler tail / Cloudflare logs).
- **Mídia 404**:
  - Verifique `R2_KEY_PREFIX` e `SOCIAL_MEDIA_MAX_AGE_DAYS`.
- **UNAUTHORIZED**:
  - Sessão do CRM expirada ou ausente (login necessário).
