# 🔔 Webhook Architecture - GitHub Actions → Wix

## 📋 Visão Geral

Esta arquitetura usa **webhooks** para comunicação direta entre GitHub Actions e Wix, eliminando a necessidade de polling e tornando o sistema mais eficiente e responsivo.

---

## 🏗️ Arquitetura Atualizada

```
┌─────────────────────────────────────────────────────────────────┐
│                      FLUXO COM WEBHOOK                          │
└─────────────────────────────────────────────────────────────────┘

     USUÁRIO                    WIX                   GITHUB
        │                        │                       │
        │  1. Preenche          │                       │
        │     Formulário        │                       │
        └──────────────────────>│                       │
                                │                       │
                                │  2. Salva no BD       │
                                │  3. Cria CSV          │
                                │  4. Commit via API    │
                                └──────────────────────>│
                                                        │
                        ┌───────────────────────────────┤
                        │  5. GitHub Actions Trigger    │
                        │     (on push: inscricoes/)    │
                        └───────────────────────────────┤
                                                        │
                        ┌───────────────────────────────┤
                        │  6. Processa Selenium         │
                        │     - Acessa Sprinta          │
                        │     - Aplica cupom            │
                        │     - Gera checkout           │
                        └───────────────────────────────┤
                                                        │
                        ┌───────────────────────────────┤
                        │  7. HTTP POST webhook         │
                        │     (checkout_urls.json)      │
                                │<──────────────────────┘
                                │
                        ┌───────┴───────┐
                        │  8. Atualiza  │
                        │     BD Wix    │
                        └───────┬───────┘
                                │
        ┌──────────────────────<│  9. Email/Notif
        │  10. Acessa email     │
        │      e vai checkout   │
        └──────────────────────>│

```

---

## 🔑 Diferenças vs. Arquitetura Anterior

| Aspecto | Arquitetura Anterior (Polling) | Nova Arquitetura (Webhook) |
|---------|-------------------------------|----------------------------|
| **Comunicação** | Wix faz polling a cada 3s | GitHub Actions notifica Wix |
| **Timeout** | 30 segundos máximo | Sem limite de tempo |
| **Eficiência** | ⚠️ Múltiplas requisições | ✅ 1 requisição apenas |
| **Experiência** | Usuário aguarda 10-30s | Usuário recebe email |
| **Confiabilidade** | ⚠️ Pode perder resultado | ✅ Garantido por webhook |
| **Escalabilidade** | ⚠️ Limitada | ✅ Excelente |

---

## 📦 Componentes

### 1️⃣ **GitHub Actions Workflow**

**Arquivo:** `.github/workflows/process-inscricoes-v2.yml`

**Mudança Principal:**
```yaml
- name: Enviar resultado para Webhook do Wix
  run: |
    curl -X POST "https://manage.wix.com/_api/webhook-trigger/report/..." \
      -H "Content-Type: application/json" \
      -d @checkout_urls.json
```

**O que faz:**
- Processa inscrição com Selenium
- Gera `checkout_urls.json`
- **Envia via HTTP POST** para webhook do Wix
- Não precisa commitar resultado no repositório

---

### 2️⃣ **Wix Webhook Receiver**

**Arquivo:** `WIX_WEBHOOK_RECEIVER.jsw`

**Função Principal:** `post_githubWebhookResult(request)`

**O que faz:**
1. Recebe payload JSON do GitHub Actions
2. Valida estrutura dos dados
3. Atualiza participantes no banco de dados Wix
4. Adiciona `checkoutUrl` e status
5. Retorna confirmação

**Configuração no Wix:**
```javascript
// Backend → http-functions.js
import { post_githubWebhookResult } from 'backend/github-webhook-receiver';

export function post_githubWebhookResult(request) {
  return post_githubWebhookResult(request);
}
```

---

### 3️⃣ **Wix Frontend (Atualizado)**

**Arquivo:** `WIX_PAGINA_INSCRICAO.js`

**Mudanças:**
- ❌ Remove polling
- ✅ Redireciona para página de confirmação
- ✅ Usuário recebe email quando pronto

**Fluxo:**
1. Usuário preenche formulário
2. Sistema salva no BD (status: "processing")
3. Sistema commita CSV no GitHub
4. Usuário é redirecionado para página "Inscrição Confirmada"
5. Webhook atualiza BD automaticamente
6. Sistema envia email com link de checkout

---

## ⚙️ Configuração

### 🔐 **1. Configurar Webhook no Wix**

**A. Criar http-functions.js:**

1. Abra Wix Editor → Backend Code (Velo)
2. Crie arquivo: `Backend → http-functions.js`
3. Cole o código:

```javascript
import { post_githubWebhookResult } from 'backend/github-webhook-receiver';

export function post_githubWebhookResult(request) {
  return post_githubWebhookResult(request);
}
```

**B. Copiar código do webhook receiver:**

1. Crie arquivo: `Backend → github-webhook-receiver.jsw`
2. Cole código de `WIX_WEBHOOK_RECEIVER.jsw`

**C. URL do webhook:**

O Wix já forneceu o webhook URL:
```
https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/1004dd78-1254-4a06-9757-ee73eb07df1d
```

✅ Este URL já está configurado no workflow!

---

### 📧 **2. Configurar Email Automático**

Quando o webhook atualizar o participante, envie email:

```javascript
// Em WIX_WEBHOOK_RECEIVER.jsw → atualizarParticipante()

import wixCRM from 'wix-crm-backend';

async function atualizarParticipante(resultado) {
  // ... código existente ...

  // Enviar email
  await wixCRM.emailContact('inscricao-confirmada', resultado.email, {
    variables: {
      name: resultado.name,
      checkoutUrl: resultado.checkout_url
    }
  });

  console.log(`📧 Email enviado para ${resultado.email}`);
}
```

---

### 🎨 **3. Criar Página de Confirmação**

No Wix, crie página `/inscricao-confirmada` com:

```
┌────────────────────────────────────┐
│   ✅ Inscrição Recebida!          │
│                                    │
│   Sua inscrição está sendo        │
│   processada. Você receberá um    │
│   email em até 2 minutos com o    │
│   link para pagamento.            │
│                                    │
│   📧 Verifique sua caixa de       │
│       entrada e spam              │
└────────────────────────────────────┘
```

---

## 📊 Formato do Payload (JSON)

**Enviado pelo GitHub Actions:**

```json
{
  "success": true,
  "processed_at": "2025-06-15T14:30:00Z",
  "results": [
    {
      "name": "João Silva",
      "email": "joao@email.com",
      "phone": "11999999999",
      "cpf": "12345678900",
      "bday": "15/03/1990",
      "gender": "m",
      "shirt_size": "M",
      "team": "Espaço Facial",
      "checkout_url": "https://sprinta.com.br/checkout/abc123def",
      "discount_applied": "ESPACOFACIALNH10",
      "success": true
    }
  ]
}
```

**Em caso de erro:**

```json
{
  "success": false,
  "error": "Descrição do erro",
  "filename": "inscricao_2025-06-15T14-30-00",
  "timestamp": "2025-06-15T14:30:00Z"
}
```

---

## 🧪 Como Testar

### **Teste 1: Workflow Manual**

```bash
cd /Users/jubenitogarcia/Downloads/Sprinta

# 1. Criar CSV de teste
cat > inscricoes/inscricao_test_$(date +%s).csv << 'EOF'
name;email;phone;cpf;bday;gender;shirt_size;team
João Webhook Test;joao.webhook@test.com;11999887766;12345678900;15/03/1990;m;M;Espaço Facial
EOF

# 2. Commit e push
git add inscricoes/
git commit -m "test: webhook test"
git push origin main

# 3. Acompanhar workflow
echo "🔍 Abra: https://github.com/jubenitogarcia/Sprinta-Scraper/actions"
```

**Você deve ver:**
- ✅ Workflow executado
- ✅ Log: "Enviando resultado para webhook do Wix..."
- ✅ HTTP Status: 200
- ✅ Webhook enviado com sucesso!

### **Teste 2: Verificar Wix**

1. Abra Console do Wix (Backend Logs)
2. Procure por: `🔔 Webhook recebido do GitHub Actions!`
3. Verifique banco de dados atualizado

---

## 🔧 Troubleshooting

### ❌ **"Webhook retornou status 400/500"**

**Problema:** Erro no código do webhook receiver

**Solução:**
1. Verifique logs do Wix Backend
2. Confirme que `http-functions.js` está configurado
3. Valide estrutura do JSON enviado

### ❌ **"Participante não encontrado"**

**Problema:** Email não corresponde ao banco

**Solução:**
- Certifique-se que `enviarInscricaoParaGitHub()` salva no BD **antes** de commitar CSV
- Verifique se email está lowercase em ambos

### ❌ **"Webhook não recebe payload"**

**Problema:** URL incorreta

**Solução:**
```bash
# Verifique URL no workflow:
cat .github/workflows/process-inscricoes-v2.yml | grep "webhook-trigger"

# Deve ser exatamente:
https://manage.wix.com/_api/webhook-trigger/report/4e65b86c-5428-4b90-aa76-564e5185bb93/1004dd78-1254-4a06-9757-ee73eb07df1d
```

---

## 📈 Vantagens desta Arquitetura

### ✅ **Eficiência**
- **1 requisição** ao invés de 10+ (polling)
- Sem timeout de 30s
- Processamento assíncrono real

### ✅ **Experiência do Usuário**
- Não precisa aguardar na página
- Recebe email quando pronto
- Sem "loading" infinito

### ✅ **Confiabilidade**
- Webhook garante entrega
- Retry automático (Wix tem retry built-in)
- Logs completos de auditoria

### ✅ **Escalabilidade**
- Suporta múltiplas inscrições simultâneas
- Sem limite de tempo de processamento
- GitHub Actions em paralelo

---

## 📚 Próximos Passos

1. ✅ Commit arquivos atualizados
2. ✅ Configurar webhook no Wix
3. ✅ Criar página de confirmação
4. ✅ Configurar template de email
5. ✅ Testar fluxo completo
6. 🚀 Deploy em produção!

---

**Criado por:** Jubênito Garcia
**Repositório:** [jubenitogarcia/Sprinta-Scraper](https://github.com/jubenitogarcia/Sprinta-Scraper)
**Data:** Outubro 2025
**Versão:** 2.0 - Webhook Architecture
