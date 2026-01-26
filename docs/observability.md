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
  Ex.: `https://crm.skincos.com.br/api/health,https://api.skincos.com.br/health,https://api.skincos.com.br/insumos/health`
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

## Runbook mínimo

1. Validar status com os endpoints de health.
2. Verificar logs de Worker/Pages e CRM API.
3. Confirmar D1/R2 status no painel Cloudflare.
4. Mitigar (rollback, fix, rate limits, cache) e registrar incidente.
