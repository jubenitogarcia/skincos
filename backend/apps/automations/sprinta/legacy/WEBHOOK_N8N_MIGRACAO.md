# 🔄 Migração do Webhook - Wix para n8n Local

## 📊 Resumo da Mudança

### Antes (Wix):
```
URL: <PREENCHER_COM_ENV:WEBHOOK_URL>
Autenticação: Token no URL (usar variável de ambiente)
```

### Depois (n8n Local):
```
URL: ${WEBHOOK_URL}
Autenticação: Basic Auth
User: ${WEBHOOK_USER}
Senha: ${WEBHOOK_PASSWORD}
```

---

## ✅ Mudanças Implementadas

### 1. Função `send_wix_webhook()` Atualizada

**Novos parâmetros:**
```python
def send_wix_webhook(
    participant_data: Optional[Dict[str, Any]] = None,
    submission_id: Optional[str] = None,
    success: bool = True,
    redirect_url: Optional[str] = None,
    webhook_url: str = "",
    webhook_user: Optional[str] = None,      # ← NOVO
    webhook_password: Optional[str] = None   # ← NOVO
) -> bool:
```

**Suporte a Basic Auth:**
```python
from requests.auth import HTTPBasicAuth

auth = None
if webhook_user and webhook_password:
    auth = HTTPBasicAuth(webhook_user, webhook_password)

response = requests.post(
    webhook_url,
    json=payload,
    auth=auth,  # ← Basic Auth
    timeout=30
)
```

---

## 🧪 Testes Realizados

### ✅ Teste 1: Importação da Função
```bash
python -c "from sprinta_automation import send_wix_webhook; print('OK')"
# Resultado: ✅ OK
```

### ✅ Teste 2: Payload Completo (12 campos)
```bash
python test_webhook_quick.py
```

**Payload enviado:**
```json
{
  "submissionId": "inscricao_2025-10-05T18-45-30_idf3da204f_linha3",
  "success": true,
  "redirectUrl": "https://checkout.sprinta.com.br/v27310473FctPA32SzolNIrs",
  "nome": "João",
  "sobrenome": "Silva Santos",
  "email": "joao.silva@espacofacial.com.br",
  "telefone": "51999887766",
  "cpf": "12345678900",
  "genero": "Masculino",
  "corrida": "5K Espaço Facial",
  "dataNascimento": "15/03/1990",
  "tamanho": "G"
}
```

**Autenticação:**
```
🔒 Basic Auth (usuário: ${WEBHOOK_USER})
```

**Resultado:**
```
❌ 404 - Webhook "POST sprinta" não está registrado no n8n
```

**Causa:** O workflow no n8n não está ativo ou não existe.

---

## 🔧 Configuração do n8n

### Passo 1: Criar Workflow no n8n

1. Abrir n8n: http://localhost:5678
2. Criar novo workflow
3. Adicionar nó **Webhook**

### Passo 2: Configurar Webhook Node

**Configurações básicas:**
```
Webhook:
├─ HTTP Method: POST
├─ Path: sprinta
├─ Authentication: Basic Auth
│  ├─ User: ${WEBHOOK_USER}
│  └─ Password: ${WEBHOOK_PASSWORD}
└─ Response: Immediately
```

**URL resultante:**
```
${WEBHOOK_URL}
```

### Passo 3: Processar Dados Recebidos

Adicionar nós para processar o payload:

```
Webhook (Trigger)
  ↓
Set Node (Extrair dados)
  ↓
Function Node (Processar lógica)
  ↓
HTTP Request (Enviar para Wix/CRM)
  ↓
Respond to Webhook
```

### Passo 4: Ativar Workflow

**IMPORTANTE:** Clicar em **"Active"** no canto superior direito!

---

## 📦 Exemplo de Payload Recebido

O n8n receberá este payload:

```json
{
  "headers": {
    "content-type": "application/json",
    "authorization": "Basic <PREENCHER_COM_ENV:WEBHOOK_AUTH>",
    "user-agent": "Sprinta-Automation/2.0"
  },
  "body": {
    "submissionId": "inscricao_2025-10-05T18-45-30_idf3da204f_linha3",
    "success": true,
    "redirectUrl": "<PREENCHER_COM_ENV:REDIRECT_URL>",
    "nome": "João",
    "sobrenome": "Silva Santos",
    "email": "<PREENCHER_COM_ENV:EMAIL>",
    "telefone": "<PREENCHER_COM_ENV:TELEFONE>",
    "cpf": "<PREENCHER_COM_ENV:CPF>",
    "genero": "Masculino",
    "corrida": "<PREENCHER_COM_ENV:CORRIDA>",
    "dataNascimento": "<PREENCHER_COM_ENV:DATA_NASCIMENTO>",
    "tamanho": "<PREENCHER_COM_ENV:TAMANHO>"
  }
}
```

---

## 🔄 Acessar Dados no n8n

### No Set Node:

```javascript
// Dados do participante
{{ $json.body.submissionId }}
{{ $json.body.nome }}
{{ $json.body.sobrenome }}
{{ $json.body.email }}
{{ $json.body.telefone }}
{{ $json.body.cpf }}
{{ $json.body.genero }}
{{ $json.body.corrida }}
{{ $json.body.dataNascimento }}
{{ $json.body.tamanho }}

// Status da inscrição
{{ $json.body.success }}
{{ $json.body.redirectUrl }}
```

---

## 🎯 Fluxo Completo

```mermaid
┌─────────────────────────────────────────────────────────────┐
│ 1. Google Sheets (Formulário Wix)                          │
│    └─ Novo participante preenche formulário                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Google Apps Script                                       │
│    ├─ Exporta linha como CSV                               │
│    └─ Commit para GitHub                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. GitHub Actions                                            │
│    ├─ Detecta novo CSV                                     │
│    ├─ Executa sprinta_automation.py                        │
│    └─ Variáveis:                                           │
│       ├─ WEBHOOK_URL                                       │
│       ├─ WEBHOOK_USER                                      │
│       └─ WEBHOOK_PASSWORD                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Automação Python (Selenium)                              │
│    ├─ Login no Sprinta                                     │
│    ├─ Preenche formulário                                  │
│    ├─ Aplica cupom                                         │
│    ├─ Gera checkout URL                                    │
│    └─ Prepara payload (12 campos)                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. HTTP POST com Basic Auth                                │
│    ├─ URL: localhost:5678/webhook/sprinta                 │
│    ├─ Auth: Basic (novohamburgo@espacofacial.com.br)      │
│    └─ Payload: 12 campos JSON                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. n8n Workflow                                             │
│    ├─ Recebe webhook                                       │
│    ├─ Valida autenticação                                  │
│    ├─ Processa dados                                       │
│    ├─ Envia para Wix (HTTP Request)                       │
│    ├─ Atualiza CRM                                         │
│    ├─ Envia email                                          │
│    └─ Registra log                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 Configurar Secrets no GitHub

Para usar no GitHub Actions, adicionar 3 secrets:

### 1. WEBHOOK_URL
```
${WEBHOOK_URL}  # Defina via variável de ambiente/secret
```

### 2. WEBHOOK_USER
```
${WEBHOOK_USER}  # Defina via variável de ambiente/secret
```

### 3. WEBHOOK_PASSWORD
```
${WEBHOOK_PASSWORD}  # Defina via variável de ambiente/secret
```

---

## 📝 Atualizar GitHub Actions Workflow

### Adicionar variáveis de ambiente:

```yaml
- name: Executar automação
  env:
    SPRINTA_EMAIL: ${{ secrets.SPRINTA_EMAIL }}
    SPRINTA_PASSWORD: ${{ secrets.SPRINTA_PASSWORD }}
    WEBHOOK_URL: ${{ secrets.WEBHOOK_URL }}          # ← NOVO
    WEBHOOK_USER: ${{ secrets.WEBHOOK_USER }}        # ← NOVO
    WEBHOOK_PASSWORD: ${{ secrets.WEBHOOK_PASSWORD }}# ← NOVO
```

### Atualizar chamada do script:

```yaml
python sprinta_automation.py "$CSV_FILE"
```

O script automaticamente usará as variáveis de ambiente.

---

## 🧪 Comandos de Teste

### Teste 1: Verificar se servidor está online
```bash
curl -I "${WEBHOOK_URL}"
```

**Resultado esperado:**
```
HTTP/1.1 404 Not Found  (workflow não ativo)
ou
HTTP/1.1 401 Unauthorized  (workflow ativo, mas sem auth)
```

---

### Teste 2: Teste com autenticação
```bash
curl -X POST \
  -u "${WEBHOOK_USER}:${WEBHOOK_PASSWORD}" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}' \
  "${WEBHOOK_URL}"
```

**Resultado esperado (workflow ativo):**
```json
{"success": true}
```

---

### Teste 3: Teste com payload completo
```bash
python test_webhook_quick.py
```

---

### Teste 4: Teste com todos os cenários
```bash
python test_webhook_local.py
```

---

## 📊 Comparação: Wix vs n8n

| Recurso | Wix Webhook | n8n Local |
|---------|-------------|-----------|
| **URL** | Fixa (Wix gerencia) | Customizável |
| **Autenticação** | Token no URL | Basic Auth |
| **Processamento** | Limitado (código Wix) | Ilimitado (workflow completo) |
| **Logs** | Limitados | Completos (todas as execuções) |
| **Debugging** | Difícil | Fácil (interface visual) |
| **Integrações** | Apenas Wix APIs | 300+ integrações |
| **Custo** | Incluído no Wix | Gratuito (self-hosted) |
| **Performance** | Depende do Wix | Depende do servidor |
| **Escalabilidade** | Limitada | Customizável |

---

## 🎓 Exemplo de Workflow n8n

### Workflow Básico:

```
1. Webhook (Trigger)
   ├─ Method: POST
   ├─ Path: sprinta
   └─ Auth: Basic Auth

2. Set (Extrair dados)
   ├─ submissionId: {{ $json.body.submissionId }}
   ├─ email: {{ $json.body.email }}
   ├─ nome: {{ $json.body.nome }}
   └─ checkoutUrl: {{ $json.body.redirectUrl }}

3. IF (Verificar sucesso)
   └─ Condition: {{ $json.body.success }} === true

4. HTTP Request (Enviar para Wix)
   ├─ Method: POST
   ├─ URL: https://wix-api-endpoint.com
   └─ Body: Dados do participante

5. Send Email (Notificar participante)
   ├─ To: {{ $json.body.email }}
   ├─ Subject: Link de Pagamento - Sprinta
   └─ Body: Seu link: {{ $json.body.redirectUrl }}

6. Respond to Webhook
   └─ Status: 200
```

---

## ✅ Checklist de Implementação

- [x] Função `send_wix_webhook()` atualizada com Basic Auth
- [x] Scripts de teste criados
- [x] Documentação completa
- [ ] Workflow n8n criado e ativo
- [ ] Secrets configuradas no GitHub
- [ ] Workflow do GitHub Actions atualizado
- [ ] Teste end-to-end realizado
- [ ] Monitoramento configurado

---

## 🐛 Troubleshooting

### Erro 404: "webhook não registrado"

**Causa:** Workflow não existe ou não está ativo no n8n

**Solução:**
1. Abrir n8n (localhost:5678)
2. Criar workflow com Webhook node
3. Configurar path: `sprinta`
4. **Ativar workflow** (toggle superior direito)

---

### Erro 401: "Unauthorized"

**Causa:** Credenciais Basic Auth incorretas

**Solução:**
1. Verificar usuário e senha no n8n
2. Conferir variáveis de ambiente
3. Testar com curl

---

### Erro: "Connection refused"

**Causa:** Servidor n8n não está rodando

**Solução:**
```bash
# Iniciar n8n
n8n start

# Ou com Docker
docker start n8n
```

---

**Data:** 5 de Outubro de 2025
**Versão:** 3.0 - Webhook com n8n e Basic Auth
**Status:** ✅ Código implementado, aguardando configuração do n8n
