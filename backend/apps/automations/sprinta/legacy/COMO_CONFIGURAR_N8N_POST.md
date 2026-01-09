# 🔧 Corrigir Configuração do Webhook n8n

## ❌ Problema Identificado

O webhook está configurado para **GET**, mas o código envia **POST**.

### Teste realizado:

```bash
# GET funciona ✅
curl -X GET http://localhost:5678/webhook/sprinta
# Resposta: {"message":"Workflow was started"}

# POST não funciona ❌
curl -X POST http://localhost:5678/webhook/sprinta
# Resposta: 404 - "This webhook is not registered for POST requests"
```

---

## ✅ Solução: Configurar webhook para POST

### Passo 1: Abrir n8n

Acesse: http://localhost:5678

---

### Passo 2: Editar o Workflow

1. Abrir o workflow que tem o webhook `sprinta`
2. Clicar no nó **Webhook**

---

### Passo 3: Configurar o Webhook Node

**Configurações necessárias:**

```
┌─────────────────────────────────────────────────────┐
│ Webhook Node Configuration                          │
├─────────────────────────────────────────────────────┤
│                                                      │
│ HTTP Method: POST                 ← IMPORTANTE!     │
│   ○ GET                                             │
│   ● POST                          ← Selecionar      │
│   ○ DELETE                                          │
│   ○ PATCH                                           │
│   ○ PUT                                             │
│                                                      │
│ Path: sprinta                     ← Manter         │
│                                                      │
│ Authentication: None              ← OK             │
│                                                      │
│ Response:                                           │
│   ● Immediately                   ← OK             │
│   ○ When last node finishes                        │
│   ○ Using Respond to Webhook node                  │
│                                                      │
│ Response Code: 200                ← OK             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

### Passo 4: Salvar e Ativar

1. Clicar em **"Save"** (ou usar Ctrl+S / Cmd+S)
2. Verificar se o toggle **"Active"** está ligado (canto superior direito)
3. O workflow deve mostrar: **"Active"** em verde

---

### Passo 5: Testar com curl

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}' \
  http://localhost:5678/webhook/sprinta
```

**Resultado esperado:**
```json
{"message": "Workflow was started"}
```
ou
```json
{"success": true}
```

**Não deve retornar:** 404 ou erro de método

---

### Passo 6: Testar com Python

```bash
python test_webhook_simple.py
```

**Resultado esperado:**
```
🎉 SUCESSO! Webhook funcionou!
✅ Webhook enviado com sucesso! Status: 200
```

---

## 🎯 Checklist de Configuração

- [ ] Abrir n8n (localhost:5678)
- [ ] Encontrar workflow com webhook "sprinta"
- [ ] Clicar no nó Webhook
- [ ] Mudar HTTP Method de GET para **POST**
- [ ] Verificar Path: `sprinta`
- [ ] Authentication: `None` (ou configurar Basic Auth)
- [ ] Response: `Immediately`
- [ ] Salvar workflow (Ctrl+S / Cmd+S)
- [ ] Ativar workflow (toggle "Active")
- [ ] Testar com curl
- [ ] Testar com `python test_webhook_simple.py`

---

## 🔍 Verificação Visual

### Como deve ficar:

```
Workflow: [Nome do seu workflow]         🟢 Active

┌──────────────────────────────────────┐
│        Webhook (Trigger)             │
│  ┌────────────────────────────────┐  │
│  │ HTTP Method: POST              │  │
│  │ Path: sprinta                  │  │
│  │ Authentication: None           │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
              ↓
┌──────────────────────────────────────┐
│     [Seus próximos nós aqui]         │
└──────────────────────────────────────┘
```

---

## 🧪 Testes de Validação

### Teste 1: Básico (curl)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"test": "funcionou"}' \
  http://localhost:5678/webhook/sprinta
```

### Teste 2: Com payload mínimo
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "submissionId": "test-001",
    "success": true,
    "redirectUrl": "https://teste.com"
  }' \
  http://localhost:5678/webhook/sprinta
```

### Teste 3: Com payload completo (Python)
```bash
python test_webhook_simple.py
```

---

## 📊 Troubleshooting

### Erro: "404 Not Found"

**Causa:** Workflow não está ativo OU path incorreto

**Solução:**
1. Verificar se workflow está **Active** (verde)
2. Verificar se path é exatamente `sprinta` (sem `/` no início)

---

### Erro: "Method not allowed" ou "GET instead of POST"

**Causa:** HTTP Method está configurado como GET

**Solução:**
1. Editar Webhook node
2. Mudar para **POST**
3. Salvar e reativar workflow

---

### Erro: "401 Unauthorized"

**Causa:** Authentication está habilitada

**Solução:**
1. Editar Webhook node
2. Authentication: selecionar **None**
3. OU fornecer credenciais corretas no código

---

### Sucesso mas dados não aparecem

**Causa:** Workflow não está processando os dados

**Solução:**
1. Adicionar nó **Set** ou **Function** após o Webhook
2. Verificar logs de execução no n8n
3. Ir em Executions (menu lateral) para ver detalhes

---

## 📝 Exemplo de Workflow Completo

### Workflow Mínimo Funcional:

```
1. Webhook (Trigger)
   ├─ Method: POST
   ├─ Path: sprinta
   └─ Auth: None

2. Set (Processar dados)
   └─ Extrair: {{ $json.body.submissionId }}

3. Code (Log dos dados)
   └─ console.log($input.all())

4. Respond to Webhook
   └─ Status: 200
```

---

## ✅ Confirmação de Sucesso

Quando funcionar, você verá:

### No Terminal:
```
📤 Enviando webhook...
✅ Webhook enviado com sucesso! Status: 200
📄 Resposta: {"message":"Workflow was started"}

🎉 SUCESSO! Webhook funcionou!
```

### No n8n (Executions):
```
✅ Execution #123
   Started: 2025-10-05 19:00:00
   Status: Success
   Duration: 0.2s

   Data received:
   - submissionId: test-123
   - nome: João
   - email: joao@test.com
   [... todos os 12 campos]
```

---

**Data:** 5 de Outubro de 2025
**Status:** ⏳ Aguardando configuração POST no n8n
**Próximo passo:** Mudar HTTP Method para POST
