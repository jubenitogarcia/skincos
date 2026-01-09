# 🚀 Guia de Configuração Completo - Webhook com Web Module

## 📋 Visão Geral

Esta solução usa **Wix Web Modules** (nova arquitetura) para receber resultados do GitHub Actions e redirecionar automaticamente os clientes para o checkout com desconto aplicado.

---

## 🎯 Fluxo Completo

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO ATUALIZADO                             │
└─────────────────────────────────────────────────────────────────┘

1️⃣  Cliente preenche formulário no Wix
     ↓
2️⃣  Frontend envia dados para backend Wix
     ↓
3️⃣  Backend Wix commita CSV no GitHub
     ↓
4️⃣  Barra de progresso inicia (30s visual)
     ↓
5️⃣  GitHub Actions detecta CSV → dispara workflow
     ↓
6️⃣  Selenium processa inscrição (~8-10s)
     - Acessa Sprinta
     - Aplica cupom ESPACOFACIALNH10
     - Gera checkout URL
     ↓
7️⃣  GitHub Actions → HTTP POST para Wix Web Module
     POST /_functions-dev/checkoutWebhook/receiveCheckout
     Body: checkout_urls.json
     ↓
8️⃣  Web Module armazena URL em memória (Map)
     ↓
9️⃣  Frontend faz polling (1 req/s) ao Web Module
     GET /_functions-dev/checkoutWebhook/checkStatus?email=...
     ↓
🔟  Quando URL chega → Redireciona automaticamente! 🎉
```

---

## ⚙️ PASSO 1: Configurar Wix Web Module

### 1.1. Criar Web Module no Wix

1. Abra **Wix Editor**
2. Clique no ícone **Code** (`</>`) no menu lateral esquerdo
3. Vá em **Backend** → **Add a web module**
4. Nome do arquivo: **`checkoutWebhook.web.js`**
5. Copie e cole o conteúdo de: `WIX_WEB_MODULE_checkoutWebhook.web.js`
6. Salve o arquivo (Ctrl+S ou Cmd+S)

### 1.2. Verificar Estrutura

Sua estrutura deve ficar assim:

```
📁 Backend
├── 📄 checkoutWebhook.web.js    ← NOVO! (Web Module)
├── 📄 sendToWebhook.jsw         ← Existente (envia CSV para GitHub)
└── 📄 http-functions.js         ← Existente (suas outras funções)
```

### 1.3. Publicar Site

**IMPORTANTE:** Você precisa **publicar o site** para que os endpoints fiquem disponíveis!

1. Clique em **Publish** no canto superior direito
2. Aguarde a publicação completar
3. Anote a URL do seu site: `https://SEU_USUARIO.wixsite.com/SEU_SITE`

---

## ⚙️ PASSO 2: Configurar Frontend Wix

### 2.1. Atualizar Código da Página

1. Vá na página do **formulário de inscrição**
2. Clique no ícone **Code** para abrir o editor da página
3. **Substitua todo o código** pelo conteúdo de: `WIX_FRONTEND_formulario.js`
4. Salve (Ctrl+S ou Cmd+S)

### 2.2. Verificar Elementos da Página

Certifique-se de que sua página tem estes elementos com os IDs corretos:

| Elemento | ID | Tipo | Descrição |
|----------|----|----- |-----------|
| Formulário | `#eventInvite` | Wix Form | Formulário principal |
| Botão | `#sendButton` | Button | Botão de envio |
| Container | `#progressBarContainer` | Box | Container da barra (oculto inicialmente) |
| Barra | `#progressBarFill` | Shape/Box | Barra de progresso visual |
| Erro (opcional) | `#errorMessage` | Text | Mensagem de erro |

**Campos do formulário (field names):**
- `name` - Nome completo
- `email` - Email
- `phone` - Telefone
- `cpf` - CPF
- `bday` - Data de nascimento
- `gender` - Gênero (m/f)
- `shirtSize` - Tamanho da camiseta (P/M/G/GG/XG)

### 2.3. Publicar Alterações

Clique em **Publish** novamente para aplicar as mudanças.

---

## ⚙️ PASSO 3: Configurar GitHub Secret

### 3.1. Obter URL do Web Module

Após publicar seu site Wix, a URL do Web Module será:

```
https://SEU_USUARIO.wixsite.com/SEU_SITE/_functions-dev/checkoutWebhook/receiveCheckout
```

**Exemplo real:**
```
https://espacofacial.wixsite.com/inscricao/_functions-dev/checkoutWebhook/receiveCheckout
```

### 3.2. Adicionar Secret no GitHub

1. Acesse: https://github.com/jubenitogarcia/Sprinta-Scraper/settings/secrets/actions
2. Clique em **New repository secret**
3. Preencha:
   - **Name:** `WIX_WEBHOOK_URL`
   - **Secret:** `https://SEU_SITE.wixsite.com/SEU_SITE/_functions-dev/checkoutWebhook/receiveCheckout`
4. Clique em **Add secret**

---

## ⚙️ PASSO 4: Criar Páginas de Fallback (Opcional)

Crie estas páginas no Wix para melhor experiência do usuário:

### 4.1. Página: `/inscricao-confirmada`

```
┌─────────────────────────────────────────┐
│   ✅ Inscrição Confirmada!             │
│                                         │
│   Sua inscrição foi recebida com       │
│   sucesso!                              │
│                                         │
│   Você receberá um email em breve       │
│   com o link de pagamento.              │
│                                         │
│   📧 Verifique sua caixa de entrada    │
│       e também a pasta de spam          │
└─────────────────────────────────────────┘
```

### 4.2. Página: `/inscricao-expirada` (opcional)

```
┌─────────────────────────────────────────┐
│   ⏱️ Sessão Expirada                   │
│                                         │
│   Sua sessão expirou.                   │
│                                         │
│   Por favor, faça uma nova inscrição.   │
│                                         │
│   [Botão: Nova Inscrição]               │
└─────────────────────────────────────────┘
```

### 4.3. Página: `/erro-processamento` (opcional)

```
┌─────────────────────────────────────────┐
│   ❌ Erro no Processamento             │
│                                         │
│   Ocorreu um erro ao processar sua      │
│   inscrição.                            │
│                                         │
│   Entre em contato conosco:             │
│   📧 contato@espacofacial.com.br       │
│   📱 (11) 99999-9999                   │
└─────────────────────────────────────────┘
```

---

## 🧪 PASSO 5: Testar a Integração

### 5.1. Teste Local (CSV Manual)

```bash
cd /Users/jubenitogarcia/Downloads/Sprinta

# Criar CSV de teste
cat > inscricoes/teste_$(date +%s).csv << 'EOF'
name;email;phone;cpf;bday;gender;shirt_size;team
João Teste Web Module;joao.teste@test.com;11999887766;12345678900;15/03/1990;m;M;Espaço Facial
EOF

# Commit e push
git add inscricoes/
git commit -m "test: teste web module"
git push origin main

# Acompanhar workflow
echo "🔍 Acompanhe em: https://github.com/jubenitogarcia/Sprinta-Scraper/actions"
```

### 5.2. Verificar Logs

**GitHub Actions:**
1. Abra: https://github.com/jubenitogarcia/Sprinta-Scraper/actions
2. Clique no workflow mais recente
3. Procure por:
   - ✅ "Webhook enviado com sucesso!"
   - ✅ "HTTP Status Code: 200"

**Wix (Site Monitoring):**
1. Wix Editor → **Code** → **Site Monitoring**
2. Procure por:
   - 📥 "Webhook recebido do GitHub Actions"
   - ✅ "URL armazenada para joao.teste@test.com"

### 5.3. Teste End-to-End (Formulário Wix)

1. Abra seu site publicado
2. Preencha o formulário
3. Clique em "Enviar"
4. Observe:
   - Botão desabilita
   - Barra de progresso aparece (~2.5s)
   - Barra cresce por ~10-15 segundos
   - **Redirecionamento automático para checkout!** 🎉

---

## 🔍 Troubleshooting

### ❌ "WIX_WEBHOOK_URL não configurado"

**Problema:** Secret não foi adicionado no GitHub

**Solução:**
1. Vá em: Settings → Secrets → Actions
2. Adicione `WIX_WEBHOOK_URL` com a URL completa do Web Module

---

### ❌ "Erro 404: Endpoint não encontrado"

**Problema:** Web Module não foi publicado ou URL incorreta

**Solução:**
1. Certifique-se de **publicar o site** após criar o Web Module
2. Verifique a URL no Secret:
   ```
   https://SEU_SITE.wixsite.com/SEU_SITE/_functions-dev/checkoutWebhook/receiveCheckout
   ```
3. Teste manualmente com curl:
   ```bash
   curl "https://SEU_SITE.wixsite.com/SEU_SITE/_functions-dev/checkoutWebhook/status"
   ```

---

### ❌ Polling não encontra URL (timeout)

**Problema:** Workflow não enviou ou Web Module não armazenou

**Verificações:**

1. **GitHub Actions está executando?**
   - Veja: https://github.com/jubenitogarcia/Sprinta-Scraper/actions
   - Status deve ser ✅ verde

2. **Webhook foi enviado?**
   - Nos logs do workflow, procure por "HTTP Status Code: 200"

3. **Web Module recebeu?**
   - Site Monitoring no Wix deve mostrar "Webhook recebido"

4. **Email está correto?**
   - Frontend usa: `email.toLowerCase().trim()`
   - Web Module armazena: `email.toLowerCase().trim()`
   - **Devem ser idênticos!**

---

### ❌ "Erro 500: Erro interno no servidor Wix"

**Problema:** Erro no código do Web Module

**Solução:**
1. Abra **Site Monitoring** no Wix Editor
2. Veja a mensagem de erro completa
3. Verifique se o código foi copiado corretamente
4. Comum: erro de sintaxe JavaScript

---

## 📊 Endpoints Disponíveis

Após publicar, estes endpoints ficam disponíveis:

### 1. POST - Receber Resultado (GitHub Actions)
```
POST /_functions-dev/checkoutWebhook/receiveCheckout

Body (JSON):
{
  "success": true,
  "processed_at": "2025-10-03T20:30:00Z",
  "results": [
    {
      "email": "joao@example.com",
      "checkout_url": "https://sprinta.com.br/checkout/abc123",
      "discount_applied": "ESPACOFACIALNH10",
      "success": true
    }
  ]
}

Response:
{
  "success": true,
  "message": "Webhook processado com sucesso",
  "processed": 1,
  "stored": 1
}
```

### 2. GET - Verificar Status (Frontend)
```
GET /_functions-dev/checkoutWebhook/checkStatus?email=joao@example.com

Response (URL pronta):
{
  "ready": true,
  "checkoutUrl": "https://sprinta.com.br/checkout/abc123",
  "discount": "ESPACOFACIALNH10",
  "elapsedSeconds": 12
}

Response (ainda processando):
{
  "ready": false,
  "message": "Processando... aguarde"
}
```

### 3. GET - Status do Sistema (Debug)
```
GET /_functions-dev/checkoutWebhook/status

Response:
{
  "status": "online",
  "storedUrls": 3,
  "timestamp": "2025-10-03T20:30:00Z",
  "message": "Checkout Webhook Web Module está funcionando"
}
```

---

## ✅ Checklist Final

Antes de ir para produção, verifique:

- [ ] Web Module criado e salvo (`checkoutWebhook.web.js`)
- [ ] Frontend atualizado com novo código
- [ ] Elementos da página com IDs corretos
- [ ] Site publicado no Wix
- [ ] `WIX_WEBHOOK_URL` configurado no GitHub Secrets
- [ ] Workflow atualizado (commit feito)
- [ ] Teste manual executado com sucesso
- [ ] Teste end-to-end no formulário funcionando
- [ ] Páginas de fallback criadas
- [ ] Logs do Site Monitoring verificados

---

## 🎉 Conclusão

Você agora tem:

✅ **Webhook moderno** com Web Modules (não será descontinuado)
✅ **Polling eficiente** (1 req/s por 60s máximo)
✅ **Barra de progresso visual** (30s)
✅ **Redirecionamento automático** para checkout
✅ **Fallback robusto** (páginas de confirmação)
✅ **Sistema de retry** (3 tentativas no curl)
✅ **Logs completos** (GitHub + Wix)
✅ **Produção ready!** 🚀

---

**Próximo passo:** Monitorar as primeiras inscrições reais e ajustar timeouts se necessário!

**Criado por:** Jubênito Garcia
**Data:** 3 de Outubro de 2025
**Versão:** 3.0 - Web Module Architecture
