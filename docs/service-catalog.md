# Catálogo De Serviços

Este catálogo define os serviços críticos do repositório, suas dependências, os checks mínimos e o runbook de referência. O objetivo é reduzir operação implícita.

## Website público

- Caminho: `modules/site-public/website/`
- Dono primário: `@jubenitogarcia`
- Backup operacional: `TBD (criar time GitHub antes de exigir review de code owner por domínio)`
- Propósito: site público, agenda, APIs de booking e integrações de marketing.
- Dependências críticas: Cloudflare Workers/Pages, D1 do booking, Turnstile, provedores de e-mail/notificação, analytics/pixels.
- SLO alvo: disponibilidade 99,9%; p95 de `/api/booking/status` <= 800 ms.
- Gates mínimos: `npm --prefix modules/site-public/website run lint`, `typecheck`, `test`, `build`.
- Runbooks: `docs/observability.md`, `docs/staging.md`.

## CRM / Escala / Ponto

- Caminho: `frontend/`
- Dono primário: `@jubenitogarcia`
- Backup operacional: `TBD`
- Propósito: CRM interno, módulos Escala, Ponto, Social e operações administrativas.
- Dependências críticas: Cloudflare Pages Functions, CRM API, Escala API, R2, autenticação local controlada.
- SLO alvo: disponibilidade 99,5%; `/_proxy-status` íntegro em produção e preview.
- Gates mínimos: `npm --prefix frontend run lint`, `typecheck`, `test`, `build`, Playwright para fluxos sensíveis.
- Runbooks: `docs/escala-runbook.md`, `docs/ponto-runbook.md`, `docs/observability.md`.

## CRM API

- Caminho: `backend/apps/crm-api/`
- Dono primário: `@jubenitogarcia`
- Backup operacional: `TBD`
- Propósito: backend operacional do CRM, autenticação, módulos de apoio e integrações.
- Dependências críticas: PostgreSQL/serviços externos, OAuth, páginas do CRM, segredos locais controlados.
- SLO alvo: disponibilidade 99,5%; endpoints críticos com erro < 1% em janelas de 5 minutos.
- Gates mínimos: `npm --prefix backend/apps/crm-api test`.
- Runbooks: `docs/observability.md`, `docs/auth.md`.

## Escala API

- Caminho: `backend/apps/escala-api/`
- Dono primário: `@jubenitogarcia`
- Backup operacional: `TBD`
- Propósito: persistência e consulta da agenda/equipe da Escala.
- Dependências críticas: Cloudflare Worker, D1, `ESCALA_ACTOR_HMAC_KEY`.
- SLO alvo: disponibilidade 99,5%; `/api/escala/health` <= 800 ms.
- Gates mínimos: smoke via CRM e deploy controlado.
- Runbooks: `docs/escala-runbook.md`, `docs/staging.md`.

## Automações Python centrais

- Caminho: `backend/config/`, `backend/libs/`, `backend/apps/automations/`
- Dono primário: `@jubenitogarcia`
- Backup operacional: `TBD`
- Propósito: automações operacionais e bibliotecas compartilhadas.
- Dependências críticas: `config.json`, Google APIs, Umbler, WhatsApp, runners locais/GitHub.
- Gates mínimos: `cd backend && python -m pytest tests/unit --cov=config --cov-fail-under=80`.
- Runbooks: `docs/secrets-rotation.md`, `docs/observability.md`.

## Lacuna atual

- O repositório ainda não tem times GitHub separados para enforcement real de ownership por domínio.
- Até isso existir, o catálogo acima é a fonte operacional e `CODEOWNERS` continua centralizado no único owner disponível.
