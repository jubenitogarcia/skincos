# 🔐 Configurar Secret do Webhook no GitHub

## ❌ Problema Atual

O webhook está dando **erro 404** porque a secret `WIX_WEBHOOK_URL` não está configurada no GitHub Actions.

```
❌ Erro ao enviar webhook: 404 Client Error: Not Found for url: ***
```

---

## ✅ Solução: Adicionar Secret no GitHub

### Passo 1: Acessar o Repositório

1. Abra o navegador
2. Vá para: https://github.com/jubenitogarcia/Sprinta-Scraper

---

### Passo 2: Acessar Settings → Secrets

1. Clique em **"Settings"** (no menu superior do repositório)
2. No menu lateral esquerdo, clique em **"Secrets and variables"**
3. Clique em **"Actions"**

---

### Passo 3: Adicionar Nova Secret

1. Clique em **"New repository secret"** (botão verde)
2. Preencha os campos:

**Name (exatamente assim):**
```
WIX_WEBHOOK_URL
```

**Secret (copie e cole esta URL):**
```
https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f
```

3. Clique em **"Add secret"**

---

## 📸 Visual de Onde Adicionar

```
GitHub Repository
└── Settings (aba superior)
    └── Secrets and variables (menu lateral)
        └── Actions
            └── Repository secrets
                └── [New repository secret] ← CLIQUE AQUI
                    ├── Name: WIX_WEBHOOK_URL
                    └── Secret: https://manage.wix.com/_api/webhook-trigger/report/...
```

---

## ✅ Verificar se Funcionou

Após adicionar a secret:

1. **Não precisa fazer commit** - secrets são configurações do GitHub
2. Na próxima inscrição, o webhook funcionará automaticamente
3. Você verá nos logs:

```
📤 Enviando webhook para Wix...
🔗 URL: ***  ← GitHub censura por segurança
📦 Payload: {
  "submissionId": "...",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/..."
}
✅ Webhook enviado com sucesso!  ← SUCESSO!
```

---

## 🔍 Secrets Necessárias (Checklist)

Verifique se você tem **todas** estas secrets configuradas:

- [ ] **SPRINTA_EMAIL** - Email de login do Sprinta
- [ ] **SPRINTA_PASSWORD** - Senha do Sprinta
- [ ] **WIX_WEBHOOK_URL** - URL do webhook (adicionar agora!)

---

## 🧪 Testar Webhook Manualmente

Se quiser testar localmente antes:

```bash
cd /Users/jubenitogarcia/Downloads/Sprinta

# Definir variável de ambiente
export WIX_WEBHOOK_URL="https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f"

# Testar com arquivo de teste
python sprinta_automation.py inscricoes/inscricao_test_1759536881.csv
```

---

## 📝 URL do Webhook (para referência)

**URL completa:**
```
https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/e19eb522-0ffd-4c88-bab0-f06837221b5f
```

**Componentes:**
- `4e65b86c-5428-4b90-aa76-564e5185bb93` - ID do webhook
- `e19eb522-0ffd-4c88-bab0-f06837221b5f` - Token de segurança

---

## ⚠️ Importante

- ✅ A URL está **correta** no código (`sprinta_automation.py`, linha 1077)
- ✅ O workflow está **configurado** para usar a secret (linha 118)
- ❌ A **secret não existe** no GitHub ainda
- ✅ Após adicionar a secret, tudo funcionará automaticamente

---

## 🎯 Resultado Esperado

**Antes (sem secret):**
```
❌ Erro ao enviar webhook: 404 Client Error: Not Found for url: ***
```

**Depois (com secret):**
```
✅ Webhook enviado com sucesso!
```

---

**Data:** 5 de Outubro de 2025
**Status:** ⏳ Aguardando configuração da secret
