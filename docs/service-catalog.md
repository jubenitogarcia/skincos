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

## Atendimento / Clientes isolado

- Caminho: `crm/api/server/atendimento/` e `crm/console/functions/api/atendimento/`.
- Runtime nativo: `crm-atendimento-staging.service` e `crm-atendimento-production.service`; o processo `crm.service` não é reiniciado.
- Propósito: superfície Clientes/Atendimento com release imutável por SHA, banco/role próprios, health público sanitizado e readiness interno.
- Estado inicial de produção: somente GET/HEAD/diagnósticos autorizados; `commercialContactWritesEnabled=false`, canário vazio e nenhuma gravação comercial, consentimento, contato, mensagem, campanha ou decisão de identidade.
- Dependências críticas: PostgreSQL dedicado, schema pré-gerenciado, HMAC de ator v2 com nonce anti-replay, túnel dedicado e arquivo de controle fail-closed.
- O refresh genérico de fontes permanece desabilitado na primeira promoção porque seu alvo histórico de produção é o CRM compartilhado; a ingestão isolada exige runner target-bound para o banco Clientes dedicado.
- SLO alvo: health p95 <= 1000 ms; readiness 503 durante indisponibilidade de banco; sem PII em logs/métricas/artefatos.
- Gates mínimos: `npm --prefix crm/api test`, `npm --prefix crm/console run typecheck`, smoke assinado sintético e `scripts/validate-atendimento-production-readonly.sh`.
- Runbooks: `docs/runbooks/clientes-production-readonly-runtime.md`, `docs/runbooks/atendimento-independent-release.md`.

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
