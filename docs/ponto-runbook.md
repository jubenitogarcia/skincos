# Runbook — Relógio‑Ponto (CRM)

Este documento descreve **como validar, diagnosticar e operar** o módulo **Ponto** em produção.

## 1) Arquitetura (3 camadas)
1. **CRM (frontend)**: `frontend/PontoModule.tsx`
2. **Proxy Pages Functions**: `frontend/functions/api/ponto/[[path]].ts`
3. **Worker Ponto (Insumos)**: `backend/apps/insumos/src/routes/ponto.js`

---

## 2) Variáveis e secrets (produção)

### Cloudflare Pages (CRM)
- `PONTO_API_TARGET` → URL do backend (ex.: `https://api.skincos.com.br`) (**recomendado**)
- `INSUMOS_API_TARGET` → fallback de target caso `PONTO_API_TARGET` não exista (mesmo target usado por `/api/auth/*` e `/api/insumos/*`)
- `PONTO_PROXY_TOKEN` → secret de autenticação do proxy
- `PONTO_ACTOR_HMAC_KEY` → **obrigatório**: secret para assinatura do actor (employee) (não há fallback para `PONTO_PROXY_TOKEN`)
- `PONTO_ADMIN_TOKEN` → secret para rotas admin (injeção no proxy)

### Cloudflare Workers (API/Insumos)
- `PONTO_ADMIN_TOKEN`
- `PONTO_PROXY_TOKEN`
- `PONTO_ACTOR_HMAC_KEY`
- `PONTO_AUDIT_HMAC_KEY` (opcional, mas recomendado)
- `PONTO_TEMPLATES_KEY` (opcional; necessário se criptografar biometria)

---

## 3) Checklist rápido de saúde (produção)

### 3.1 Proxy
```
GET https://crm.skincos.com.br/api/ponto/_proxy-status
```
Esperado:
- `ok: true`
- `effectiveTargetConfigured: true`
- `adminTokenConfigured: true`
Observação:
- `targetConfigured: true` indica `PONTO_API_TARGET` explícito; se `false`, o proxy pode estar usando `INSUMOS_API_TARGET` como fallback.

### 3.2 Worker
```
GET https://crm.skincos.com.br/api/ponto/health
```
Esperado:
- `ok: true`
- `storage: "d1"`

---

## 4) Checklist funcional (UI)
1) Abrir **Ponto** no CRM  
2) Conferir **Build** no header (ex.: `Build: 0f1196c`)  
3) Clicar em **Diagnóstico**  
4) Confirmar JSON de `_proxy-status` e `health`

### 4.1 Smoke automatizado (UI) com Playwright (sem credenciais no script)
Rodar (do root do repo):
```
NODE_PATH=frontend/node_modules node frontend/scripts/ponto-ui-smoke.cjs
```
Se precisar logar manualmente (recomendado por segurança), rode em modo visível:
```
HEADED=1 LOGIN_WAIT_MS=600000 NODE_PATH=frontend/node_modules node frontend/scripts/ponto-ui-smoke.cjs
```
Artefatos: `output/playwright/` (screenshots + trace).

---

## 5) Fluxo mínimo (Admin → Funcionário → Audit)
1) Admin cria funcionário  
2) Admin define PIN  
3) Admin (opcional) cadastra face  
4) Funcionário bate ponto (Face → PIN)  
5) Admin exporta CSV  
6) Admin valida audit:
```
GET /api/ponto/admin/audit/verify
```

---

## 6) Problemas comuns

### UI desatualizada
**Sinal:** você ainda vê campos antigos (token admin ou PIN fallback sempre visível).  
**Solução:** conferir o **Build** no header e fazer hard refresh (Ctrl/Cmd+Shift+R).

### Admin não acessa
**Sinal:** erro `ADMIN_TOKEN_NOT_CONFIGURED`.  
**Ação:** validar secrets do Pages em `_proxy-status`.

### Face não reconhece
**Sinal:** erro `NOT_RECOGNIZED`.  
**Ação:** confirmar `face-models` carregados e biometria cadastrada.

---

## 7) Logs e rastreio
- Use o **x-request-id** exibido no diagnóstico ou nos erros para buscar no Cloudflare.
