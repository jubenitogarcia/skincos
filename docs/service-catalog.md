# Catálogo De Serviços

Este catálogo define os serviços críticos do repositório, suas dependências, os checks mínimos e o runbook de referência. O objetivo é reduzir operação implícita.

## Website público

- Caminho: `website/`
- Dono primário: `@jubenitogarcia`
- Backup operacional: `TBD (criar time GitHub antes de exigir review de code owner por domínio)`
- Propósito: site público, agenda, APIs de booking e integrações de marketing.
- Dependências críticas: Cloudflare Workers/Pages, D1 do booking, Turnstile, provedores de e-mail/notificação, analytics/pixels.
- SLO alvo: disponibilidade 99,9%; p95 de `/api/booking/status` <= 800 ms.
- Gates mínimos: `npm --prefix website run lint`, `typecheck`, `test`, `build`.
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

- Caminho: `crm/api/`
- Dono primário: `@jubenitogarcia`
- Backup operacional: `TBD`
- Propósito: backend operacional do CRM, autenticação, módulos de apoio e integrações.
- Dependências críticas: PostgreSQL/serviços externos, OAuth, páginas do CRM, segredos locais controlados.
- SLO alvo: disponibilidade 99,5%; endpoints críticos com erro < 1% em janelas de 5 minutos.
- Gates mínimos: `npm --prefix crm/api test`.
- Runbooks: `docs/observability.md`, `docs/auth.md`.

## Clientes / Atendimento isolado (não promovido)

- Caminho: `crm/api/server/atendimentoRuntime.js`, `ops/runtime/units/crm-atendimento-*.service`.
- Propósito: superfície de Clientes/Atendimento independente, inicialmente só
  leitura, com HMAC v2, replay persistente, controle local fail-closed e
  shutdown gracioso. Não inicia Harmonia nem o worker contínuo.
- Bind: somente loopback (`8111` staging, `8110` produção); health PII-free é
  independente do banco e readiness é interno/tokenizado.
- Dependências críticas: banco dedicado/role read-only, controle SHA, ledger de
  replay, migrations aditivas de fontes e aprovação clínica, antes de qualquer
  rota pública dedicada.
- Estado: template e testes versionados; nenhuma instalação, túnel, DNS,
  migration ou promoção é inferida deste catálogo.
- Gates mínimos: `npm --prefix crm/api test`, testes do proxy do console,
  `node scripts/tests/clientes-production-readonly-runtime.test.mjs`, smoke
  assinado do SHA instalado e rollback comprovado.
- Runbook: `docs/runbooks/clientes-production-readonly-runtime.md`.

## Escala API

- Caminho: `workforce/schedule/`
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
