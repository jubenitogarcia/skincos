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
- `PONTO_TEMPLATES_CACHE_TTL_MS` (opcional; TTL do cache de templates faciais no Kiosk; default 30000)

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
- `proxyTokenConfigured: true`
- `actorKeyConfigured: true`
Observação:
- `targetConfigured: true` indica `PONTO_API_TARGET` explícito; se `false`, o proxy pode estar usando `INSUMOS_API_TARGET` como fallback.

### 3.2 Worker
```
GET https://crm.skincos.com.br/api/ponto/health
```
Esperado:
- `ok: true`
- `storage: "d1"`
- `templatesCacheTtlMs` coerente com a configuração esperada (ex.: `30000`)
- `templatesCache` com contadores (`hits/misses`) e `ageMs` (útil para confirmar cache aquecido)

### 3.3 Validar cache do Kiosk (headers)
Para confirmar que o Kiosk está realmente usando cache de templates (e não refazendo query completa no D1 a cada chamada), use um token de dispositivo válido e faça 2 chamadas seguidas:
```
POST https://crm.skincos.com.br/api/ponto/device/identify
```
Verifique os headers:
- `x-ponto-templates-cache: hit|miss`
- `x-ponto-templates-cache-age-ms`
- `x-ponto-templates-cache-ttl-ms`
- `x-ponto-templates-cache-size`

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

### 4.2 Smoke automatizado (UI) no GitHub Actions (produção)
Workflow: `.github/workflows/ponto-ui-smoke.yml`

**Requisitos**
- Habilitar o agendamento (repo → Settings → Secrets and variables → Actions → Variables):
  - `ENABLE_PONTO_UI_SMOKE=true`
- Criar um usuário dedicado “smoke bot” no CRM (evite usar credenciais pessoais).
- Configurar os secrets no GitHub (repo → Settings → Secrets and variables → Actions):
  - `PONTO_SMOKE_EMAIL`
  - `PONTO_SMOKE_PASSWORD`

**Bootstrap/repair do smoke bot (recomendado)**
- Script (idempotente) que garante que o usuário existe com role `ADMIN` e rotaciona a senha, atualizando os secrets do GitHub:
```
NODE_PATH=frontend/node_modules node frontend/scripts/bootstrap-ponto-smoke-admin.cjs
```
Pré‑requisito: precisa existir uma sessão admin salva em `output/playwright/storage-crm.json` (você cria isso rodando o `ponto-ui-smoke.cjs` em `HEADED=1` e logando manualmente).

**O que ele valida**
- Build badge existe. Observação: a assercao de SHA so e aplicada quando o smoke e executado junto ao deploy (after-automerge) ou quando voce fornece um `expect_sha` no `workflow_dispatch`.
- Diagnóstico carrega (`/_proxy-status` e `/health`).
- Invariantes de UI (admin sem campo de token; PIN fallback do Kiosk oculto por padrão).
- (Opcional) mutações rápidas: cria/vincula funcionário por email, seta PIN, valida `/me`, e limpa em seguida.

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

### Vínculo de login não salva
**Sinal:** erro `LOGIN_EMAIL_ALREADY_IN_USE`.  
**Ação:** o email já está vinculado a outro funcionário ativo; revise no Admin e mantenha email único por funcionário.

### Funcionário não consegue carregar `/me`
**Sinal:** erro `LOGIN_EMAIL_AMBIGUOUS`.  
**Ação:** há mais de um funcionário ativo com o mesmo email; corrija os cadastros duplicados antes de retestar.

### `_proxy-status` diz que secrets não estão configurados, mesmo após sync
**Sinal:** `proxyTokenConfigured=false` / `actorKeyConfigured=false` / `adminTokenConfigured=false`, mas o workflow de sync está “success”.  
**Causa provável:** em Cloudflare Pages, alterações de env vars podem exigir um novo deploy para entrarem em vigor no runtime.  
**Ação:** rode o reconcile do Pages (ele também faz smoke check):
- Workflow: `.github/workflows/deploy-crm-pages-reconcile.yml`

### Face não reconhece
**Sinal:** erro `NOT_RECOGNIZED`.  
**Ação:** confirmar `face-models` carregados e biometria cadastrada.

### Retorno HTML com Cloudflare 1101
**Sinal:** erro com `UPSTREAM_WORKER_EXCEPTION` (ou tela “Worker threw exception”).  
**Ação:** usar `x-request-id` + `cf-ray` no Cloudflare Logs para identificar a exceção do Worker upstream.

---

## 7) Logs e rastreio
- Use o **x-request-id** e **cf-ray** exibidos no diagnóstico/erros para buscar no Cloudflare.
