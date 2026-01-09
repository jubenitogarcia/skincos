# Deploy no Cloudflare (CRM Core)

Objetivo: publicar o **CRM (frontend + API core)** no Cloudflare para uso interno, mantendo os demais módulos (WhatsApp/Agent Zero/automações) como **capabilities** que podem rodar fora do Cloudflare.

## Premissas importantes (para não criar ambiguidade)

- **Cloudflare não executa Puppeteer/Chrome**: módulos WhatsApp (web.js) precisam rodar em uma máquina/VM/container fora do Cloudflare.
- **Cloudflare Workers/Pages Functions não falam TCP com Postgres**: para Postgres use um provider com driver HTTP (ex: Neon) via `@neondatabase/serverless`.
- O monorepo já separa “core” e “capabilities” em `backend/capabilities.json`; o CRM consome esse catálogo via `/api/core/capabilities`.

## Arquitetura recomendada (incremental)

### Fase 1 — CRM Frontend no Cloudflare Pages
- Build do frontend: `crm` (Vite/React).
- Publicação: Cloudflare Pages (build command: `npm run build`, output: `dist/`).
- Variáveis:
  - `VITE_NO_AUTH=true` (temporário para uso interno).
  - `VITE_WHATSAPP_GATEWAY_URL` apontando para a URL pública do módulo WhatsApp (ex: `https://wa.suaempresa.com/api/unified`).

### Fase 2 — CRM API como Worker/Pages Functions (core-only)
- Migrar endpoints **core** do CRM API para runtime de Worker:
  - `GET /api/core/capabilities` (catálogo)
  - endpoints de dados (conversas/mensagens) persistindo no Postgres (Neon) em vez de JSON local.
- Manter endpoints que dependem de processos locais (orquestrador WhatsApp/local spawn) **fora** do Worker.

### Fase 3 — Capabilities como serviços externos
- WhatsApp Official Module: rodar em uma VM (Docker ou macOS) e expor por domínio (Cloudflare Tunnel recomendado).
- Agent Zero: rodar em VM/container e expor por domínio interno.
- Scrapers/automações: rodar como jobs (cron) em infraestrutura própria.

## Checklist prático (quando formos implementar)

1) Definir domínios internos:
- `crm.seudominio.com` (Pages)
- `api.crm.seudominio.com` (Worker/Functions)
- `wa.seudominio.com` (WhatsApp official-module em VM)

2) Ajustar variáveis do core (Cloudflare):
- `DATABASE_URL` (Neon)
- `UNIFIED_SYSTEM_URL` (URL pública do WhatsApp)
- `CRM_UNIFIED_API_KEY` (chave)

3) Trocar persistência file-based por Postgres:
- Conversas/mensagens/templates que hoje usam `*.json` → tabelas.

4) Segurança (mesmo interno):
- Restringir por Cloudflare Access (SSO) ou IP allowlist.
- Rotacionar chaves `X-API-Key`.
