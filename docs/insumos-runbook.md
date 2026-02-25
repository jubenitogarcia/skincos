# Runbook — Insumos (CRM)

Este documento descreve como validar, diagnosticar e operar o módulo **Insumos** em produção.

## 1) Arquitetura (camadas)
1. **Frontend CRM**: `frontend/InsumosModule.tsx`
2. **Proxy Pages Functions**: `frontend/functions/api/insumos/[[path]].ts`
3. **Worker API (Insumos)**: `backend/apps/insumos/src/worker.js`
4. **Persistência**: Cloudflare **D1** (sem Google Sheets)

## 2) Invariantes obrigatórios
- Modo de armazenamento: **D1-only**.
- `zero demo` por padrão: dados simulados só com flag explícita.
- Auto-sync resiliente: pausa temporária após falhas repetidas de API.
- Políticas (lote/validade/FEFO) são **por item**; categorias são apenas sugestão/organização.
- Overview/Insights com endpoints agregados:
  - `/api/insumos/analytics/overview`
  - `/api/insumos/analytics/insights`

## 3) Checklist rápido de saúde

### 3.1 Health do Insumos (produção)
```bash
curl -sS https://crm.skincos.com.br/api/insumos/health
```
Esperado:
- `ok: true`
- `storage: "d1"`
- `dbConfigured: true`

### 3.1.1 Proxy status (Pages → Worker)
```bash
curl -sS https://crm.skincos.com.br/api/insumos/_proxy-status
```
Esperado:
- `ok: true`
- `target` aponta para o Worker de Insumos

### 3.1.2 Share history (fallback tolerante)
```bash
curl -sS https://crm.skincos.com.br/api/insumos/share/history?limit=12
```
Esperado:
- `200` com `data: []` quando não configurado
- `200` com itens quando o recurso estiver ativo

### 3.2 Sessão autenticada
```bash
curl -sS -I https://crm.skincos.com.br/api/auth/me
```
Esperado:
- `200` com sessão ativa
- `401` quando não autenticado (comportamento esperado fora da sessão)

### 3.2.1 Auditoria read‑only (opcional)
Se `INSUMOS_AUDIT_TOKEN` estiver configurado no Worker:
```bash
curl -sS -H "x-insumos-audit-token: <token>" \
  "https://crm.skincos.com.br/api/insumos/analytics/overview?lite=1&unidade=novo-hamburgo"
```
Esperado:
- `200` sem necessidade de sessão
- Resposta **somente analytics** (sem itens completos)

### 3.3 Políticas por item (erros comuns)
- Exemplo de erro esperado quando política do item exige validade:
  - `POLICY_REQUIRES_EXPIRY` → “Este item exige Data de validade pela política do item.”

### 3.3 Verificação visual no CRM
1. Abrir o módulo **Insumos**.
2. Confirmar ausência do banner **DADOS SIMULADOS** por padrão.
3. Confirmar cards/alertas carregando com dados reais.

## 4) Diagnóstico de incidentes (500/503/travamento)

### 4.1 Sinais comuns
- Storm de requests em `/api/insumos/*`.
- Erros `500/503` ao entrar ou após movimentações.
- UI lenta com DevTools aberto.

### 4.2 Fluxo de diagnóstico
1. Abrir DevTools > Network com `Preserve log`.
2. Filtrar por `api/insumos`.
3. Registrar endpoint, status e `x-request-id` dos erros.
4. Correlacionar `x-request-id` no Cloudflare Worker logs.

### 4.3 Comportamento esperado de proteção
- Auto-sync de Overview/Insights pausa após 5 falhas em 30s por 60s.
- Banner de degradação aparece com botões:
  - `Retomar auto-sync`
  - `Atualizar agora`
- Reload manual continua possível.

## 5) Testes de regressão obrigatórios
Do root do repo:
```bash
npm -C frontend run test:e2e -- \
  insumos-no-request-storm.spec.ts \
  insumos-api-concurrency.spec.ts \
  insumos-zero-demo-default.spec.ts \
  insumos-circuit-breaker.spec.ts
```

Critérios:
- Nenhum storm em `health/me`.
- Concorrência do fan-out controlada.
- Zero-demo por padrão.
- Breaker ativo sob falhas repetidas.

## 6) Alertas de produção (5xx/latência)
- Workflow: `.github/workflows/insumos-api-slo.yml`
- Script: `backend/scripts/insumos-api-slo.sh`
- Frequência: a cada 10 minutos.
- Alvo: endpoints autenticados `/api/insumos/*` (inclui overview/insights agregados).
- Critério de falha:
  - status fora de `2xx`
  - latência acima do orçamento (`INSUMOS_SLO_MAX_LATENCY_MS`)

## 7) Regras de deploy e colaboração
- Sempre via PR curto e focado.
- Habilitar auto-merge só com checks obrigatórios verdes.
- Evitar editar em paralelo os mesmos arquivos grandes (`InsumosModule.tsx`, `App.tsx`) sem sincronizar `origin/main`.
- CI guard anti-demo: `backend/scripts/ci-no-demo-guard.sh` (executado em `.github/workflows/ci-smoke.yml`).

## 8) Desenvolvimento local seguro
- Local usa proxy CRM → Worker local por padrão.
- Para auditoria local sem login, habilitar:
  - `ALLOW_DEV_AUTH_BYPASS=true` (somente GET, apenas `localhost/127.0.0.1`).
- Para evitar dados reais, mantenha `INSUMOS_API_TARGET` apontando para o Worker local.
