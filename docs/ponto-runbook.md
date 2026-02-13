# Runbook — Relógio‑Ponto (CRM)

Este documento descreve **como validar, diagnosticar e operar** o módulo **Ponto** em produção.

## 1) Arquitetura (3 camadas)
1. **CRM (frontend)**: `frontend/PontoModule.tsx`
2. **Proxy Pages Functions**: `frontend/functions/api/ponto/[[path]].ts`
3. **CRM API (backend central)**: `backend/apps/crm-api/server/pontoRoutes.js`

---

## 2) Variáveis e secrets (produção)

### Cloudflare Pages (CRM)
- `PONTO_API_TARGET` → URL do backend (ex.: `https://crm-api.seudominio.com`) (**obrigatório**)
- `PONTO_PROXY_TOKEN` → secret de autenticação do proxy
- `PONTO_ACTOR_HMAC_KEY` → **obrigatório**: secret para assinatura do actor (employee). Recomenda‑se não reutilizar o `PONTO_PROXY_TOKEN`.
- `PONTO_ADMIN_TOKEN` → secret para rotas admin (injeção no proxy)

### CRM API (backend)
- `PONTO_ADMIN_TOKEN`
- `PONTO_PROXY_TOKEN`
- `PONTO_ACTOR_HMAC_KEY`
- `PONTO_AUDIT_HMAC_KEY` (opcional, mas recomendado)
- `PONTO_TEMPLATES_KEY` (**obrigatório em produção**; criptografa biometria)

---

## 3) Checklist rápido de saúde (produção)

### 3.1 Proxy
```
GET https://crm.skincos.com.br/api/ponto/_proxy-status
```
Esperado:
- `ok: true`
- `targetConfigured: true`
- `adminTokenConfigured: true`
- `proxyTokenConfigured: true`
- `actorKeyConfigured: true`
Observação:
`targetConfigured: true` indica `PONTO_API_TARGET` explícito; sem isso o proxy não encaminha.

### 3.2 CRM API
```
GET https://crm.skincos.com.br/api/ponto/health
```
Esperado:
- `ok: true`
- `cryptoTemplates: true` (biometria criptografada)
- `cryptoAuditHmac: true` (quando `PONTO_AUDIT_HMAC_KEY` estiver configurado)

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
- Build badge contém o SHA do `main` (detecta “site desatualizado”/deploy drift).
- Diagnóstico carrega (`/_proxy-status` e `/health`).
- Invariantes de UI (admin sem campo de token; PIN fallback do Kiosk oculto por padrão).
- (Opcional) mutações rápidas: cria/vincula funcionário por email, seta PIN, valida `/me`, faz punch por PIN, valida `audit/verify`, exporta CSV e limpa em seguida.

---

## 5) Fluxo mínimo (Admin → Funcionário → Audit)
1) Admin cria funcionário  
2) Admin define PIN  
3) Admin (opcional) cadastra face  
4) Funcionário seleciona unidade (quando houver mais de uma permitida)  
5) Funcionário bate ponto (Face → PIN)  
6) Admin exporta CSV  
7) Admin valida audit:
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

### Unidade não permitida (Funcionário)
**Sinal:** erro `UNIT_ACCESS_NOT_CONFIGURED`, `UNIT_REQUIRED` ou `UNIT_FORBIDDEN`.  
**Ação:** garantir que o usuário tem `allowedUnits` no CRM e selecionar a unidade correta no Ponto.

### Biometria indisponível
**Sinal:** erro `TEMPLATES_KEY_NOT_CONFIGURED` no enroll.  
**Ação:** configurar `PONTO_TEMPLATES_KEY` no backend do CRM API.

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
