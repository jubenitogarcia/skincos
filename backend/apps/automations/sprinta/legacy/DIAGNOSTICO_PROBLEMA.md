# 🔍 Diagnóstico Completo: Por que o GitHub Actions não foi ativado

**Data:** 3 de outubro de 2025, 18:23h
**Status:** ❌ **SISTEMA NÃO FUNCIONAL**

---

## 📊 Resumo da Investigação

Testei todos os componentes da cadeia:

```
Wix → Ngrok → Webhook Server → GitHub Actions
 ?       ✅         ⚠️              ❌
```

---

## ✅ Componentes FUNCIONANDO

### 1. Ngrok (OK)
- ✅ Status: **RODANDO**
- ✅ URL: `https://eustolia-manistic-understandably.ngrok-free.dev`
- ✅ Conexões recebidas: 3 (testes manuais)
- ✅ Dashboard: `http://localhost:4040`

### 2. Webhook Server (RODANDO mas com problema)
- ✅ Status: **RODANDO** (PID: 45361)
- ✅ Porta: 5001
- ✅ Endpoint `/health`: **FUNCIONANDO**
- ⚠️ Endpoint `/webhook/sprinta`: **PROBLEMA DE CONFIGURAÇÃO**

---

## ❌ PROBLEMAS IDENTIFICADOS

### 🔴 PROBLEMA #1: Secret Token Incorreto no Wix

**O que acontece:**
- No `.env` do webhook server: `WEBHOOK_SECRET=mude-este-secret-token`
- No código Wix fornecido: `WEBHOOK_SECRET = 'change-this-secret'`
- **Resultado:** 403 Forbidden - "Token de autorização inválido"

**Teste realizado:**
```bash
curl -X POST https://eustolia-manistic-understandably.ngrok-free.dev/webhook/sprinta \
  -H "X-Secret-Token: change-this-secret" \
  -d '{"csv_content": "..."}'

# Resposta:
{
  "error": "Token de autorização inválido"
}
```

**Impacto:** ⚠️ **Wix não consegue enviar dados para o webhook**

---

### 🔴 PROBLEMA #2: GitHub Token NÃO Configurado

**O que acontece:**
- O arquivo `.env` **NÃO TEM** a variável `GITHUB_TOKEN`
- O webhook server precisa desse token para acionar o GitHub Actions
- **Resultado:** Mesmo que o Wix envie, o GitHub Actions não será acionado

**Teste realizado:**
```bash
curl -X POST https://eustolia-manistic-understandably.ngrok-free.dev/webhook/sprinta \
  -H "X-Secret-Token: mude-este-secret-token" \
  -d '{"csv_content": "..."}'

# Resposta:
{
  "status": "error",
  "message": "Erro ao acionar GitHub Action: 401 - Bad credentials"
}
```

**Impacto:** 🔥 **GitHub Actions NÃO PODE ser acionado**

---

### 🔴 PROBLEMA #3: Wix Provavelmente NÃO Está Enviando

**Evidência:**
- Ngrok recebeu **3 requisições**, todas foram:
  - `GET /health` (testes manuais)
  - **NENHUMA** `POST /webhook/sprinta` (do Wix)

**Possíveis causas:**
1. ❌ Código Wix não foi salvo/publicado
2. ❌ URL do ngrok no código Wix está desatualizada
3. ❌ Formulário Wix tem erro no JavaScript
4. ❌ Site Wix está em Preview (não Published)

---

## 🛠️ SOLUÇÃO COMPLETA

### Passo 1: Criar GitHub Token

1. Acesse: https://github.com/settings/tokens
2. Clique em **"Generate new token"** → **"Generate new token (classic)"**
3. Configure:
   - **Note:** "Sprinta Webhook Server"
   - **Expiration:** 90 days (ou No expiration)
   - **Scopes:** Marque:
     - ✅ `repo` (Full control of private repositories)
     - ✅ `workflow` (Update GitHub Action workflows)
4. Clique em **"Generate token"**
5. **COPIE O TOKEN** (começa com `ghp_...`)

---

### Passo 2: Atualizar `.env`

**Arquivo:** `/Users/jubenitogarcia/Downloads/Sprinta/.env`

```bash
# Webhook Configuration
WEBHOOK_SECRET=mude-este-secret-token
WEBHOOK_PORT=5001

# GitHub Configuration
GITHUB_TOKEN=ghp_SEU_TOKEN_AQUI
GITHUB_REPO_OWNER=jubenitogarcia
GITHUB_REPO_NAME=Sprinta-Scraper

# Sprinta Credentials
SPRINTA_EMAIL=seu_email@example.com
SPRINTA_PASSWORD=sua_senha_aqui
```

**⚠️ IMPORTANTE:** Substitua `ghp_SEU_TOKEN_AQUI` pelo token real!

---

### Passo 3: Atualizar Código Wix

**Arquivo Wix:** `backend/sendToWebhook.jsw`

**LINHA 9 e 10 - Atualizar para:**

```javascript
const WEBHOOK_URL = 'https://eustolia-manistic-understandably.ngrok-free.dev/webhook/sprinta';
const WEBHOOK_SECRET = 'mude-este-secret-token'; // ⚠️ DEVE SER IGUAL AO .env
```

---

### Passo 4: Reiniciar Webhook Server

```bash
# Parar o servidor atual
# Pressione Ctrl+C no terminal onde está rodando

# Reiniciar com .env atualizado
cd /Users/jubenitogarcia/Downloads/Sprinta
python webhook_server.py
```

---

### Passo 5: Publicar Site Wix

**CRÍTICO:** O site deve estar **PUBLICADO**, não apenas em Preview!

1. No Wix Editor, clique em **"Publish"** (canto superior direito)
2. Aguarde a publicação completar
3. Acesse o site publicado (não o preview)

---

### Passo 6: Testar Manualmente ANTES do Wix

```bash
# Com webhook server REINICIADO e .env ATUALIZADO:
curl -X POST https://eustolia-manistic-understandably.ngrok-free.dev/webhook/sprinta \
  -H "Content-Type: application/json" \
  -H "X-Secret-Token: mude-este-secret-token" \
  -d '{
    "csv_content": "name;email;phone;cpf;bday;gender;shirt_size;team\nTeste Manual;teste@example.com;11999999999;12345678901;01/01/1990;m;M;Espaço Facial"
  }'
```

**Resposta esperada:**
```json
{
  "status": "success",
  "run_id": 1234567890,
  "message": "GitHub Action acionada com sucesso!",
  "estimated_time": "8-10 segundos",
  "participants_count": 1
}
```

---

### Passo 7: Verificar GitHub Actions

Acesse: https://github.com/jubenitogarcia/Sprinta-Scraper/actions

Você deve ver:

```
🟡 Processar Inscrições Sprinta
   ⏱️ triggered by repository_dispatch
   🕐 há poucos segundos
   ⏳ In progress...
```

Aguarde ~10 segundos e deve ficar:

```
🟢 Processar Inscrições Sprinta
   ✅ Success (took 12s)
   📦 Artifact: checkout-urls
```

---

### Passo 8: Testar com Wix

Agora sim, preencha o formulário no site Wix publicado.

**Monitorar:**
1. Terminal do webhook server (deve mostrar logs)
2. Ngrok dashboard: `http://localhost:4040` (deve mostrar POST)
3. Console do browser (F12)
4. GitHub Actions (deve aparecer nova execução)

---

## 📋 Checklist de Verificação

Antes de testar novamente:

- [ ] GitHub Token criado e copiado
- [ ] `.env` atualizado com `GITHUB_TOKEN`
- [ ] `.env` tem `WEBHOOK_SECRET=mude-este-secret-token`
- [ ] Código Wix tem `WEBHOOK_SECRET = 'mude-este-secret-token'` (igual!)
- [ ] Código Wix tem URL do ngrok atualizada
- [ ] Webhook server **REINICIADO** (para ler novo .env)
- [ ] Ngrok ainda está rodando
- [ ] Site Wix **PUBLICADO** (não Preview)
- [ ] Teste manual com curl passou (status: success)
- [ ] GitHub Actions apareceu após teste manual

---

## 🎯 Ordem de Prioridade

**RESOLVA NESTA ORDEM:**

1. 🔥 **URGENTE:** Criar GitHub Token e adicionar ao `.env`
2. 🔥 **URGENTE:** Sincronizar `WEBHOOK_SECRET` entre `.env` e Wix
3. ⚠️ **IMPORTANTE:** Reiniciar webhook server
4. ⚠️ **IMPORTANTE:** Testar manualmente com curl
5. ✅ **FINAL:** Atualizar e publicar código Wix

---

## 📊 Status Atual vs Esperado

### ATUAL (NÃO FUNCIONA)

```
Wix Form (Submit)
    ↓
    ❌ Não envia ou envia com secret errado
    ↓
Ngrok (recebe mas rejeita)
    ↓
    ❌ 403 Forbidden
    ↓
Webhook Server (não processa)
    ↓
    ❌ GitHub Token ausente
    ↓
GitHub Actions (não é acionado)
    ❓ NUNCA CHEGOU AQUI
```

### ESPERADO (APÓS CORREÇÕES)

```
Wix Form (Submit)
    ↓
    ✅ POST com secret correto
    ↓
Ngrok (repassa)
    ↓
    ✅ 200 OK
    ↓
Webhook Server (processa)
    ↓
    ✅ Aciona GitHub API com token válido
    ↓
GitHub Actions (executa)
    ✅ Workflow rodando
    ↓
    ✅ Checkout URL gerado
    ↓
Wix (recebe callback)
    ✅ Redireciona usuário
```

---

## 🔍 Logs Esperados (Após Correção)

### Terminal Webhook Server:
```
INFO:__main__:======================================================================
INFO:__main__:🚀 Sprinta Webhook Server iniciado
INFO:__main__:📡 Porta: 5001
INFO:__main__:✅ GitHub Token configurado
INFO:__main__:✅ Webhook Secret configurado
INFO:__main__:======================================================================

INFO:__main__:📥 Webhook recebido de: 2804:1b3:...
INFO:__main__:✅ CSV válido recebido (1 participantes)
INFO:__main__:🚀 Acionando GitHub Actions...
INFO:__main__:✅ GitHub Action acionada com sucesso! Run ID: 1234567890
```

### Console Browser (F12):
```
📋 Dados coletados: {name: "João", email: "joao@example.com", ...}
📤 Enviando para webhook...
✅ Resposta recebida: {status: "success", ...}
✅ Checkout URL recebida: https://checkout.sprinta.com.br/...
🔄 Redirecionando para: https://checkout.sprinta.com.br/...
```

### GitHub Actions:
```
Run Setup Python
✅ Python 3.12 installed

Run Install Chrome
✅ Chrome installed

Run Install Dependencies
✅ Dependencies installed

Run Execute Automation
✅ Processing CSV...
✅ 1 participants processed
✅ Checkout URLs generated
```

---

## 💡 Resumo Executivo

**Problema Principal:** Sistema tem **2 falhas críticas** de configuração:

1. ❌ **GitHub Token ausente** → GitHub Actions não pode ser acionado
2. ❌ **Secret Token diferente** → Wix não consegue se comunicar

**Solução:**
1. Criar GitHub Token
2. Atualizar `.env` com token e confirmar secret
3. Sincronizar secret no código Wix
4. Reiniciar webhook server
5. Publicar Wix
6. Testar!

**Tempo estimado para correção:** ~10 minutos

**Prioridade:** 🔥🔥🔥 **CRÍTICA** - Sistema completamente não funcional

---

**Próximo Passo:** Criar o GitHub Token e atualizar o `.env`!
