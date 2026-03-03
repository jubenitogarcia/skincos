---
title: Observabilidade e SLOs
---

# Observabilidade e SLOs

Este documento define os SLOs mínimos e como ativar alertas para o CRM (Pages), Workers e CRM API.

## SLOs propostos

- **Disponibilidade (mensal)**: 99,9%
- **Latência (p95)**:
  - CRM Pages `/api/health`: ≤ 800ms
  - Worker API `/health` e `/insumos/health`: ≤ 800ms
- **Erros**:
  - 5xx ≥ 1% em 5m → alerta
  - Rate limit ≥ 5% em 5m → alerta
  - D1/R2 error rate ≥ 1% em 5m → alerta

## Alertas automáticos (GitHub Actions)

Workflow: `.github/workflows/uptime-slo.yml`

Variáveis (repo → Settings → Variables → Actions):
- `OBS_HEALTHCHECK_URLS` (CSV)  
  Ex.: `https://crm.skincos.com.br/api/health,https://crm.skincos.com.br/api/escala/_proxy-status,https://api.skincos.com.br/health,https://api.skincos.com.br/insumos/health,https://escala-api.skincos.com.br/api/escala/health`
- `OBS_LATENCY_MS` (default: `800`)
- `OBS_TIMEOUT_SEC` (default: `10`)

O workflow falha quando qualquer endpoint retornar status não-2xx ou ultrapassar o `OBS_LATENCY_MS`.

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
  - `CLOUDFLARE_ALERT_EMAILS` (CSV)
  - (opcional) `CLOUDFLARE_PAGES_PROJECT_IDS` (CSV)
  - (opcional) `CLOUDFLARE_PAGES_ENVIRONMENTS` (CSV, default sugerido: `production,preview`)
  - (opcional) `CLOUDFLARE_PAGES_EVENTS` (CSV)

Observação: os alertas de **5xx/latência/D1/R2/429** podem depender de produtos/telemetria adicionais (ex.: Workers Observability) e podem não estar disponíveis diretamente via Alerting API v3; mantenha também o `uptime-slo.yml` como monitor sintético.

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

1. Validar status com os endpoints de health.
2. Verificar logs de Worker/Pages e CRM API (Escala emite eventos `escala.*` e `escala.error`).
3. Confirmar D1/R2 status no painel Cloudflare.
4. Mitigar (rollback, fix, rate limits, cache) e registrar incidente.
