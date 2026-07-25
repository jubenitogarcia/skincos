---
title: Observabilidade e SLOs
---

# Observabilidade e SLOs

Este documento define os SLOs mínimos, a rota de alerta e a disciplina operacional para CRM, Website e Workers.

## Princípios

- Monitor sintético não substitui telemetria de aplicação.
- Todo alerta precisa de owner e runbook.
- Toda resposta operacional precisa de um identificador de correlação por request ou incidente.

## Monitor primário fora de GitHub e Cloudflare

O primário é o `SkincosObservabilityProbe`, uma tarefa agendada no Windows do operador. Ela executa probes públicos a cada minuto, grava estado, histórico, métricas Prometheus e um dashboard HTML em `C:\\CodexRuntime\\operator\\admin\\skincos\\observability`. Não depende de GitHub Actions nem de Workers para detectar uma indisponibilidade.

- Catálogo autoritativo: `ops/observability/catalog.json`.
- Dashboard local: `dashboard.html`; dashboard Grafana importável: `ops/observability/dashboards/skincos-operations.json`.
- Métricas: `metrics.prom`; o coletor/servidor Grafana/Prometheus é opcional e não muda o monitor primário.
- O pipeline canônico de Core Workers injeta o SHA promovido em `APP_VERSION`; a resposta não usa um nome de branch como versão.
- Alerta local obrigatório: Windows Application Event Log, source `SkincosObservability` (1001 alerta, 1002 recuperação). Webhook HTTPS é secundário e só pode ser configurado com credencial segregada fora do repositório.
- Probes de módulos ainda não implantados ficam `disabled` com motivo explícito; não geram falso verde.

Instalação/reversão no host do operador:

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\observability\scripts\Install-SkincosObservability.ps1
# rollback: Unregister-ScheduledTask -TaskName SkincosObservabilityProbe -Confirm:$false
```

Uma jornada sintética autenticada exige ator exclusivo de staging, segredo fora do Git e passos sem escrita. Enquanto Identity/Finance não estiverem implantados em staging, o catálogo a mantém desabilitada em vez de reutilizar uma sessão humana.

## SLOs propostos

- **Disponibilidade (mensal)**: 99,9%
- **Latência (p95)**:
  - Website `/api/booking/status`: ≤ 800ms
  - CRM Pages `/api/health`: ≤ 800ms
  - Worker API `/health` e `/insumos/health`: ≤ 800ms
- **Erros**:
  - 5xx ≥ 1% em 5m → alerta
  - Rate limit ≥ 5% em 5m → alerta
  - D1/R2 error rate ≥ 1% em 5m → alerta

## Owners de alerta

- Website / booking: owner `website/`
- CRM / Escala / Ponto: owner `frontend/`
- CRM API: owner `backend/apps/crm-api/`
- Infra Cloudflare / segredos: owner `.github/` + backend de domínio afetado

Até existirem times GitHub por domínio, o owner humano único deve manter a matriz acima atualizada em `docs/service-catalog.md`.

## Alertas automáticos (GitHub Actions)

Workflow: `.github/workflows/uptime-slo.yml`

Variáveis (repo → Settings → Variables → Actions):
- `OBS_HEALTHCHECK_URLS` (CSV)  
  Ex.: `https://crm.skincos.com.br/api/health,https://crm.skincos.com.br/api/escala/_proxy-status,https://api.skincos.com.br/health,https://api.skincos.com.br/insumos/health,https://escala-api.skincos.com.br/api/escala/health,https://orb.skincos.com.br/healthz`
- `OBS_LATENCY_MS` (default: `800`)
- `OBS_TIMEOUT_SEC` (default: `10`)

Secrets (repo → Settings → Secrets and variables → Actions):
- `OBS_ALERT_WEBHOOK_URL` (opcional) para receber alerta push quando o workflow falhar.

O workflow falha quando qualquer endpoint retornar status não-2xx ou ultrapassar o `OBS_LATENCY_MS`.

## Telemetria de aplicação mínima

- Booking e APIs sensíveis devem logar `request_id`, rota, status e tempo total.
- Eventos de erro devem incluir domínio funcional (`booking`, `escala`, `crm-auth`, `insumos`).
- Logs sem PII sensível: tokens, segredos e payloads integrais ficam proibidos.
- O identificador do incidente deve aparecer no postmortem e no alerta.

## Alertas no Cloudflare (produção)

Ativar alertas no **Cloudflare Dashboard** para:
- **5xx rate** (Workers + Pages)
- **Request latency p95/p99**
- **D1 errors** (timeout, transaction failures)
- **R2 errors** (4xx/5xx)
- **Rate limiting** (429)

Recomendação: configurar alertas com janelas de 5–10 minutos e rotas específicas:
- `api.skincos.com.br/*`
- `crm.skincos.com.br/api/*`

### Automação de alertas via API (baseline)

Workflow: `.github/workflows/cloudflare-alerting-apply.yml`

Este workflow cria/atualiza (idempotente) um baseline de políticas via **Cloudflare Alerting API v3**:
- Incidents (Cloudflare Status)
- Maintenance (Cloudflare Status)
- Pages events (deploy/erros)
- Passive Origin Monitoring (origin unreachable)
- HTTP DDoS (L7)
- Universal SSL events

Configuração (repo → Settings):
- **Secrets → Actions**
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_ALERTS_API_TOKEN`
  - (opcional) `CLOUDFLARE_ALERT_WEBHOOK_URL`
- **Variables → Actions**
  - `ENABLE_CLOUDFLARE_ALERTING_APPLY` = `true` para permitir a execução agendada
  - `CLOUDFLARE_ALERT_ENABLE_EMAILS` = `true` para permitir destinos por e-mail
  - `CLOUDFLARE_ALERT_EMAILS` (CSV, usado apenas quando `CLOUDFLARE_ALERT_ENABLE_EMAILS=true`)
  - (opcional) `CLOUDFLARE_PAGES_PROJECT_IDS` (CSV)
  - (opcional) `CLOUDFLARE_PAGES_ENVIRONMENTS` (CSV, default sugerido: `production,preview`)
  - (opcional) `CLOUDFLARE_PAGES_EVENTS` (CSV)

Observação: os alertas de **5xx/latência/D1/R2/429** podem depender de produtos/telemetria adicionais (ex.: Workers Observability) e podem não estar disponíveis diretamente via Alerting API v3; mantenha também o `uptime-slo.yml` como monitor sintético.
Observação 2: por segurança, o agendamento semanal e os destinos de e-mail são opt-in explícitos.

### Checklist rápido (Cloudflare)

1. **Workers / Pages → Analytics → Alerts**:
   - 5xx rate ≥ 1% (5m)
   - p95 latency ≥ 800ms (5m)
   - 429 rate ≥ 5% (5m)
2. **D1 → Analytics**:
   - D1 errors ≥ 1% (5m)
3. **R2 → Analytics**:
   - R2 4xx/5xx ≥ 1% (5m)

## Runbook mínimo

1. Validar status com os endpoints de health e confirmar qual domínio está em degradação.
2. Verificar logs de Worker/Pages e CRM API usando `request_id` ou janela temporal do alerta.
3. Confirmar D1/R2 status no painel Cloudflare.
4. Mitigar com rollback, fix ou isolamento de rota.
5. Registrar incidente com causa, impacto, owner e follow-up de prevenção.
